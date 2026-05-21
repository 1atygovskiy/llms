"""
Branch business logic for thread conversations.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from .db import DEFAULT_BRANCH_NAME, DEFAULT_BRANCH_TAG, MESSAGE_DTO_JSON_COLUMNS


class BranchService:
    def __init__(self, db):
        self.db = db

    def _get_branch(self, branch_id, user=None):
        sql_where, params = self.db.get_user_filter(user, {"id": branch_id})
        return self.db.db.one(
            f"SELECT * FROM branch {sql_where} AND id = :id AND isDeleted = 0",
            params,
        )

    def _get_thread_for_branch(self, branch_id, user=None):
        branch = self._get_branch(branch_id, user=user)
        if not branch:
            return None, None
        thread = self.db.get_thread(branch["threadId"], user=user)
        return branch, thread

    def _message_by_timestamp(self, thread_id, branch_id, timestamp):
        return self.db.db.one(
            """
            SELECT * FROM message
            WHERE threadId = :thread_id AND branchId = :branch_id AND timestamp = :timestamp
            """,
            {"thread_id": thread_id, "branch_id": branch_id, "timestamp": timestamp},
        )

    def _message_by_id(self, message_id):
        return self.db.db.one("SELECT * FROM message WHERE id = :id", {"id": message_id})

    def _row_to_message_dict(self, row):
        dto = self.db.to_dto(row, MESSAGE_DTO_JSON_COLUMNS)
        message = {
            "id": dto.get("id"),
            "timestamp": dto.get("timestamp"),
            "role": dto.get("role"),
            "content": dto.get("content"),
            "versionNumber": dto.get("versionNumber") or 1,
        }
        for src, dst in [
            ("model", "model"),
            ("toolCalls", "tool_calls"),
            ("toolCallId", "tool_call_id"),
            ("usage", "usage"),
            ("images", "images"),
            ("audios", "audios"),
            ("metadata", "metadata"),
        ]:
            if dto.get(src):
                message[dst] = dto[src]
        return message

    def _messages_up_to_timestamp(self, thread_id, branch_id, timestamp):
        rows = self.db.db.all(
            """
            SELECT * FROM message
            WHERE threadId = :thread_id AND branchId = :branch_id AND timestamp <= :timestamp
            ORDER BY timestamp ASC
            """,
            {"thread_id": thread_id, "branch_id": branch_id, "timestamp": timestamp},
        )
        return [self._row_to_message_dict(r) for r in rows]

    def _copy_messages_to_branch(
        self, conn, thread_id, source_branch_id, target_branch_id, up_to_timestamp=None
    ):
        params = {"thread_id": thread_id, "source_branch_id": source_branch_id}
        sql = """
            SELECT * FROM message
            WHERE threadId = :thread_id AND branchId = :source_branch_id
        """
        if up_to_timestamp is not None:
            sql += " AND timestamp <= :timestamp"
            params["timestamp"] = up_to_timestamp
        sql += " ORDER BY timestamp ASC"
        import sqlite3

        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()

        id_map = {}
        root_message_id = None
        prev_new_id = None

        for row in rows:
            row_dict = dict(row)
            source_id = row_dict["id"]
            message = self._row_to_message_dict(row_dict)
            new_id = self.db._insert_message_row(
                conn,
                self.db._message_dict_to_row(thread_id, target_branch_id, message),
            )
            self.db._insert_message_version(
                conn, target_branch_id, new_id, message.get("versionNumber", 1), message
            )
            id_map[source_id] = new_id
            if root_message_id is None:
                root_message_id = new_id
            if prev_new_id is not None:
                self.db._link_messages_sequence(conn, target_branch_id, prev_new_id, new_id)
            prev_new_id = new_id

        return root_message_id, id_map

    def _reference_messages_to_branch(
        self, conn, thread_id, source_branch_id, target_branch_id, up_to_timestamp
    ):
        messages = self._messages_up_to_timestamp(thread_id, source_branch_id, up_to_timestamp)
        root_message_id = None
        prev_ref_id = None

        for message in messages:
            source_row = self._message_by_timestamp(
                thread_id, source_branch_id, message["timestamp"]
            )
            if not source_row:
                continue
            source_id = source_row["id"]
            conn.execute(
                """
                INSERT OR IGNORE INTO message_relationship
                    (parentMessageId, childMessageId, branchId, relationType)
                VALUES (?, ?, ?, 'reference')
                """,
                (source_id, source_id, target_branch_id),
            )
            if root_message_id is None:
                root_message_id = source_id
            if prev_ref_id is not None:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO message_relationship
                        (parentMessageId, childMessageId, branchId, relationType)
                    VALUES (?, ?, ?, 'fork')
                    """,
                    (prev_ref_id, source_id, target_branch_id),
                )
            prev_ref_id = source_id

        return root_message_id

    def create_branch(
        self,
        thread_id: int,
        parent_message_timestamp: int,
        name: str,
        copy_mode: str = "copy",
        user=None,
    ) -> Dict[str, Any]:
        self.db.ensure_thread_branches(thread_id, user=user)
        thread = self.db.get_thread(thread_id, user=user)
        if not thread:
            raise ValueError("Thread not found")

        current_branch_id = thread["currentBranchId"]
        parent_row = self._message_by_timestamp(thread_id, current_branch_id, parent_message_timestamp)
        if not parent_row:
            raise ValueError("Parent message not found on current branch")

        copy_mode = (copy_mode or "copy").lower()
        if copy_mode not in ("copy", "reference"):
            raise ValueError("copy_mode must be 'copy' or 'reference'")

        now = datetime.now().isoformat(" ")
        with self.db.create_writer_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO branch (threadId, user, name, parentBranchId, rootMessageId, createdAt, tags, isDeleted)
                VALUES (?, ?, ?, ?, NULL, ?, '[]', 0)
                """,
                (thread_id, thread.get("user"), name or "branch", current_branch_id, now),
            )
            new_branch_id = cursor.lastrowid

            if copy_mode == "copy":
                root_id, _ = self._copy_messages_to_branch(
                    conn,
                    thread_id,
                    current_branch_id,
                    new_branch_id,
                    up_to_timestamp=parent_message_timestamp,
                )
            else:
                root_id = self._reference_messages_to_branch(
                    conn,
                    thread_id,
                    current_branch_id,
                    new_branch_id,
                    parent_message_timestamp,
                )

            if root_id:
                conn.execute(
                    "UPDATE branch SET rootMessageId = ? WHERE id = ?",
                    (root_id, new_branch_id),
                )

            conn.execute(
                "UPDATE thread SET currentBranchId = ? WHERE id = ?",
                (new_branch_id, thread_id),
            )
            conn.commit()

        messages = self.db.get_branch_messages(new_branch_id, user=user)
        return {
            "branchId": new_branch_id,
            "threadId": thread_id,
            "name": name,
            "copyMode": copy_mode,
            "messages": messages,
        }

    def switch_branch(self, thread_id: int, branch_id: int, user=None) -> Dict[str, Any]:
        self.db.ensure_thread_branches(thread_id, user=user)
        branch = self._get_branch(branch_id, user=user)
        if not branch or branch["threadId"] != thread_id:
            raise ValueError("Branch not found for thread")

        messages = self.db.get_branch_messages(branch_id, user=user)
        self.db.update_thread(
            thread_id,
            {"currentBranchId": branch_id, "messages": messages},
            user=user,
        )
        self.db.sync_main_branch_messages_json(thread_id, branch_id, messages, user=user)
        return {"threadId": thread_id, "branchId": branch_id, "messages": messages}

    def get_branch_tree(self, thread_id: int, user=None) -> Dict[str, Any]:
        self.db.ensure_thread_branches(thread_id, user=user)
        rows = self.db.db.all(
            """
            SELECT b.*, (SELECT COUNT(*) FROM message m WHERE m.branchId = b.id) AS messageCount
            FROM branch b
            WHERE b.threadId = :thread_id AND b.isDeleted = 0
            ORDER BY b.id ASC
            """,
            {"thread_id": thread_id},
        )

        nodes = {}
        roots = []
        for row in rows:
            tags = row.get("tags")
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except json.JSONDecodeError:
                    tags = []
            node = {
                "id": row["id"],
                "threadId": row["threadId"],
                "name": row["name"],
                "parentBranchId": row.get("parentBranchId"),
                "rootMessageId": row.get("rootMessageId"),
                "createdAt": row.get("createdAt"),
                "tags": tags or [],
                "messageCount": row.get("messageCount") or 0,
                "children": [],
            }
            nodes[row["id"]] = node

        for node in nodes.values():
            parent_id = node["parentBranchId"]
            if parent_id and parent_id in nodes:
                nodes[parent_id]["children"].append(node)
            else:
                roots.append(node)

        thread = self.db.get_thread(thread_id, user=user)
        return {
            "threadId": thread_id,
            "currentBranchId": thread.get("currentBranchId") if thread else None,
            "branches": roots,
        }

    def delete_branch(self, branch_id: int, user=None) -> Dict[str, Any]:
        branch, thread = self._get_thread_for_branch(branch_id, user=user)
        if not branch or not thread:
            raise ValueError("Branch not found")

        thread_id = thread["id"]
        is_active = thread.get("currentBranchId") == branch_id
        fallback_id = branch.get("parentBranchId")

        if is_active and not fallback_id:
            default = self.db.db.one(
                """
                SELECT id FROM branch
                WHERE threadId = :thread_id AND isDeleted = 0 AND id != :branch_id
                ORDER BY id ASC LIMIT 1
                """,
                {"thread_id": thread_id, "branch_id": branch_id},
            )
            fallback_id = default["id"] if default else None

        with self.db.create_writer_connection() as conn:
            conn.execute("UPDATE branch SET isDeleted = 1 WHERE id = ?", (branch_id,))
            if is_active and fallback_id:
                conn.execute(
                    "UPDATE thread SET currentBranchId = ? WHERE id = ?",
                    (fallback_id, thread_id),
                )
            conn.commit()

        switched_to = fallback_id if is_active else thread.get("currentBranchId")
        messages = []
        if switched_to:
            messages = self.db.get_branch_messages(switched_to, user=user)
            self.db.update_thread(
                thread_id,
                {"currentBranchId": switched_to, "messages": messages},
                user=user,
            )

        return {
            "deletedBranchId": branch_id,
            "activeBranchId": switched_to,
            "messages": messages,
        }

    def merge_branches(self, source_branch_id: int, target_branch_id: int, user=None) -> Dict[str, Any]:
        source = self._get_branch(source_branch_id, user=user)
        target = self._get_branch(target_branch_id, user=user)
        if not source or not target:
            raise ValueError("Branch not found")
        if source["threadId"] != target["threadId"]:
            raise ValueError("Branches must belong to the same thread")

        thread_id = source["threadId"]
        source_messages = self.db.get_branch_messages(source_branch_id, user=user)
        target_timestamps = {
            m["timestamp"] for m in self.db.get_branch_messages(target_branch_id, user=user)
        }

        merged = 0
        with self.db.create_writer_connection() as conn:
            for message in source_messages:
                if message["timestamp"] in target_timestamps:
                    continue
                new_id = self.db._insert_message_row(
                    conn,
                    self.db._message_dict_to_row(thread_id, target_branch_id, message),
                )
                self.db._insert_message_version(
                    conn,
                    target_branch_id,
                    new_id,
                    message.get("versionNumber", 1),
                    message,
                )
                merged += 1
            conn.commit()

        messages = self.db.get_branch_messages(target_branch_id, user=user)
        if thread_id and target_branch_id:
            thread = self.db.get_thread(thread_id, user=user)
            if thread and thread.get("currentBranchId") == target_branch_id:
                self.db.update_thread(thread_id, {"messages": messages}, user=user)
                self.db.sync_main_branch_messages_json(thread_id, target_branch_id, messages, user=user)

        return {
            "sourceBranchId": source_branch_id,
            "targetBranchId": target_branch_id,
            "mergedCount": merged,
            "messages": messages,
        }

    def branch_diff(self, branch_a_id: int, branch_b_id: int, user=None) -> Dict[str, Any]:
        branch_a = self._get_branch(branch_a_id, user=user)
        branch_b = self._get_branch(branch_b_id, user=user)
        if not branch_a or not branch_b:
            raise ValueError("Branch not found")

        msgs_a = {m["timestamp"]: m for m in self.db.get_branch_messages(branch_a_id, user=user)}
        msgs_b = {m["timestamp"]: m for m in self.db.get_branch_messages(branch_b_id, user=user)}

        timestamps_a = set(msgs_a.keys())
        timestamps_b = set(msgs_b.keys())

        added = [msgs_b[t] for t in sorted(timestamps_b - timestamps_a)]
        removed = [msgs_a[t] for t in sorted(timestamps_a - timestamps_b)]
        changed = []
        for ts in sorted(timestamps_a & timestamps_b):
            a = json.dumps(msgs_a[ts], sort_keys=True, default=str)
            b = json.dumps(msgs_b[ts], sort_keys=True, default=str)
            if a != b:
                changed.append({"timestamp": ts, "branchA": msgs_a[ts], "branchB": msgs_b[ts]})

        return {
            "branchAId": branch_a_id,
            "branchBId": branch_b_id,
            "added": added,
            "removed": removed,
            "changed": changed,
        }

    async def fork_thread_async(self, thread_id: int, branch_id: Optional[int] = None, user=None):
        self.db.ensure_thread_branches(thread_id, user=user)
        thread = self.db.get_thread(thread_id, user=user)
        if not thread:
            raise ValueError("Thread not found")

        source_branch_id = branch_id or thread["currentBranchId"]
        messages = self.db.get_branch_messages(source_branch_id, user=user)

        new_thread = {
            "title": (thread.get("title") or "Chat") + " (fork)",
            "model": thread.get("model"),
            "modelInfo": json.loads(thread["modelInfo"])
            if isinstance(thread.get("modelInfo"), str)
            else thread.get("modelInfo"),
            "modalities": json.loads(thread["modalities"])
            if isinstance(thread.get("modalities"), str)
            else thread.get("modalities"),
            "messages": messages,
            "tools": json.loads(thread["tools"]) if isinstance(thread.get("tools"), str) else thread.get("tools"),
            "systemPrompt": thread.get("systemPrompt"),
            "args": json.loads(thread["args"]) if isinstance(thread.get("args"), str) else thread.get("args"),
            "metadata": json.loads(thread["metadata"])
            if isinstance(thread.get("metadata"), str)
            else thread.get("metadata"),
            "parentId": thread_id,
        }
        new_id = await self.db.create_thread_async(new_thread, user=user)
        self.db.ensure_thread_branches(new_id, user=user)
        return {
            "threadId": new_id,
            "sourceThreadId": thread_id,
            "sourceBranchId": source_branch_id,
        }

    def export_branch(self, branch_id: int, user=None) -> Dict[str, Any]:
        branch, thread = self._get_thread_for_branch(branch_id, user=user)
        if not branch:
            raise ValueError("Branch not found")

        messages = self.db.get_branch_messages(branch_id, user=user)
        relationships = self.db.db.all(
            "SELECT * FROM message_relationship WHERE branchId = :branch_id",
            {"branch_id": branch_id},
        )
        versions = self.db.db.all(
            """
            SELECT * FROM message_version
            WHERE branchId = :branch_id
            ORDER BY messageId ASC, versionNumber ASC
            """,
            {"branch_id": branch_id},
        )

        tags = branch.get("tags")
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except json.JSONDecodeError:
                tags = []

        return {
            "version": 1,
            "exportedAt": datetime.now().isoformat(),
            "thread": {
                "id": branch["threadId"],
                "title": thread.get("title") if thread else None,
            },
            "branch": {
                "id": branch_id,
                "name": branch.get("name"),
                "parentBranchId": branch.get("parentBranchId"),
                "rootMessageId": branch.get("rootMessageId"),
                "tags": tags,
            },
            "messages": messages,
            "relationships": relationships,
            "versions": [
                self.db.to_dto(v, ["snapshot"]) for v in versions
            ],
        }

    def import_branch(self, payload: Dict[str, Any], thread_id: int, user=None) -> Dict[str, Any]:
        branch_data = payload.get("branch") or {}
        messages = payload.get("messages") or []
        name = branch_data.get("name") or "imported"

        self.db.ensure_thread_branches(thread_id, user=user)
        now = datetime.now().isoformat(" ")
        with self.db.create_writer_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO branch (threadId, user, name, parentBranchId, rootMessageId, createdAt, tags, isDeleted)
                VALUES (?, ?, ?, ?, NULL, ?, ?, 0)
                """,
                (
                    thread_id,
                    user,
                    name,
                    branch_data.get("parentBranchId"),
                    now,
                    json.dumps(branch_data.get("tags") or []),
                ),
            )
            new_branch_id = cursor.lastrowid
            root_id = self.db._migrate_thread_messages_to_branch(
                conn, thread_id, new_branch_id, messages, user=user
            )
            if root_id:
                conn.execute(
                    "UPDATE branch SET rootMessageId = ? WHERE id = ?",
                    (root_id, new_branch_id),
                )
            conn.execute(
                "UPDATE thread SET currentBranchId = ? WHERE id = ?",
                (new_branch_id, thread_id),
            )
            conn.commit()

        loaded = self.db.get_branch_messages(new_branch_id, user=user)
        self.db.update_thread(thread_id, {"messages": loaded, "currentBranchId": new_branch_id}, user=user)
        return {"threadId": thread_id, "branchId": new_branch_id, "messages": loaded}

    async def import_branch_async(
        self, payload: Dict[str, Any], thread_id: Optional[int] = None, user=None
    ) -> Dict[str, Any]:
        if thread_id is None:
            thread_payload = payload.get("thread") or {}
            new_thread = {
                "title": thread_payload.get("title") or "Imported chat",
                "messages": payload.get("messages") or [],
            }
            thread_id = await self.db.create_thread_async(new_thread, user=user)

        return self.import_branch(payload, thread_id=thread_id, user=user)

    def update_tags(self, branch_id: int, add: Optional[List[str]] = None, remove: Optional[List[str]] = None, user=None):
        branch = self._get_branch(branch_id, user=user)
        if not branch:
            raise ValueError("Branch not found")

        tags = branch.get("tags")
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except json.JSONDecodeError:
                tags = []
        tags = list(tags or [])

        for tag in add or []:
            if tag not in tags:
                tags.append(tag)
        for tag in remove or []:
            while tag in tags:
                tags.remove(tag)

        with self.db.create_writer_connection() as conn:
            conn.execute(
                "UPDATE branch SET tags = ? WHERE id = ?",
                (json.dumps(tags), branch_id),
            )
            conn.commit()

        return {"branchId": branch_id, "tags": tags}

    def search_branches(self, query: str, user=None, take: int = 50) -> List[Dict[str, Any]]:
        take = min(take, 200)
        params = {"q": f"%{query}%", "take": take}
        if user is None:
            user_clause = "b.user IS NULL"
        else:
            user_clause = "b.user = :user"
            params["user"] = user

        rows = self.db.db.all(
            f"""
            SELECT DISTINCT b.*, t.title AS threadTitle
            FROM branch b
            JOIN thread t ON t.id = b.threadId
            WHERE {user_clause}
            AND b.isDeleted = 0
            AND (
                b.name LIKE :q
                OR b.tags LIKE :q
                OR EXISTS (
                    SELECT 1 FROM message m
                    WHERE m.branchId = b.id
                    AND m.content LIKE :q
                )
            )
            ORDER BY b.id DESC
            LIMIT :take
            """,
            params,
        )

        results = []
        for row in rows:
            tags = row.get("tags")
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except json.JSONDecodeError:
                    tags = []
            results.append(
                {
                    "branchId": row["id"],
                    "threadId": row["threadId"],
                    "threadTitle": row.get("threadTitle"),
                    "name": row.get("name"),
                    "tags": tags,
                }
            )
        return results

    def rename_branch(self, branch_id: int, name: str, user=None) -> Dict[str, Any]:
        branch = self._get_branch(branch_id, user=user)
        if not branch:
            raise ValueError("Branch not found")
        if branch.get("name") == DEFAULT_BRANCH_NAME:
            tags = branch.get("tags")
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except json.JSONDecodeError:
                    tags = []
            if isinstance(tags, list) and DEFAULT_BRANCH_TAG in tags:
                raise ValueError("Cannot rename default main branch")

        with self.db.create_writer_connection() as conn:
            conn.execute("UPDATE branch SET name = ? WHERE id = ?", (name, branch_id))
            conn.commit()

        return {"branchId": branch_id, "name": name}

    def save_message_version(self, message_id: int, updates: Dict[str, Any], user=None) -> Dict[str, Any]:
        row = self._message_by_id(message_id)
        if not row:
            raise ValueError("Message not found")

        message = self._row_to_message_dict(row)
        message.update(updates)
        new_version = (row.get("versionNumber") or 1) + 1

        with self.db.create_writer_connection() as conn:
            conn.execute(
                """
                UPDATE message SET
                    versionNumber = ?,
                    role = ?,
                    content = ?,
                    model = ?,
                    toolCalls = ?,
                    toolCallId = ?,
                    usage = ?,
                    images = ?,
                    audios = ?,
                    metadata = ?
                WHERE id = ?
                """,
                (
                    new_version,
                    message.get("role"),
                    json.dumps(message.get("content"))
                    if message.get("content") is not None
                    else None,
                    message.get("model"),
                    json.dumps(message.get("tool_calls"))
                    if message.get("tool_calls")
                    else None,
                    message.get("tool_call_id"),
                    json.dumps(message.get("usage")) if message.get("usage") else None,
                    json.dumps(message.get("images")) if message.get("images") else None,
                    json.dumps(message.get("audios")) if message.get("audios") else None,
                    json.dumps(message.get("metadata")) if message.get("metadata") else None,
                    message_id,
                ),
            )
            self.db._insert_message_version(
                conn, row["branchId"], message_id, new_version, message
            )
            conn.commit()

        thread_id = row["threadId"]
        branch_id = row["branchId"]
        messages = self.db.get_branch_messages(branch_id, user=user)
        thread = self.db.get_thread(thread_id, user=user)
        if thread and thread.get("currentBranchId") == branch_id:
            self.db.update_thread(thread_id, {"messages": messages}, user=user)
            self.db.sync_main_branch_messages_json(thread_id, branch_id, messages, user=user)

        return {"messageId": message_id, "versionNumber": new_version, "message": message}

    def replace_branch_messages(
        self, thread_id: int, branch_id: int, messages: List[Dict[str, Any]], user=None
    ) -> List[Dict[str, Any]]:
        with self.db.create_writer_connection() as conn:
            conn.execute("DELETE FROM message_relationship WHERE branchId = ?", (branch_id,))
            conn.execute("DELETE FROM message_version WHERE branchId = ?", (branch_id,))
            conn.execute("DELETE FROM message WHERE branchId = ?", (branch_id,))
            root_id = self.db._migrate_thread_messages_to_branch(
                conn, thread_id, branch_id, messages, user=user
            )
            if root_id:
                conn.execute(
                    "UPDATE branch SET rootMessageId = ? WHERE id = ?",
                    (root_id, branch_id),
                )
            conn.commit()

        self.db.sync_main_branch_messages_json(thread_id, branch_id, messages, user=user)
        return messages

    def check_thread_conflict(self, thread_id: int, expected_updated_at, user=None) -> bool:
        """Return True if concurrent modification detected (caller should respond 409)."""
        if expected_updated_at is None:
            return False
        current = self.db.get_thread_column(thread_id, "updatedAt", user=user)
        if current is None:
            return False
        return str(current) != str(expected_updated_at)

    def append_message_to_branch(
        self, thread_id: int, branch_id: int, message: Dict[str, Any], user=None
    ) -> Dict[str, Any]:
        with self.db.create_writer_connection() as conn:
            message_id = self.db._insert_message_row(
                conn,
                self.db._message_dict_to_row(thread_id, branch_id, message),
            )
            version = message.get("versionNumber") or 1
            self.db._insert_message_version(conn, branch_id, message_id, version, message)

            last = conn.execute(
                """
                SELECT id FROM message
                WHERE branchId = ? AND id != ?
                ORDER BY timestamp DESC LIMIT 1
                """,
                (branch_id, message_id),
            ).fetchone()
            if last:
                self.db._link_messages_sequence(conn, branch_id, last[0], message_id)

            conn.commit()

        messages = self.db.get_branch_messages(branch_id, user=user)
        self.db.sync_main_branch_messages_json(thread_id, branch_id, messages, user=user)
        return {"messageId": message_id, "messages": messages}
