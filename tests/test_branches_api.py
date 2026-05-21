"""API and business-logic tests for dialog branching."""

import asyncio
import json

import pytest

from llms.extensions.app.db import DEFAULT_BRANCH_NAME


def run(coro):
    return asyncio.run(coro)


# 1b. Create branch by message id (TZ messageId)
def test_create_branch_by_message_id(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    main_id = db.get_thread(sample_thread)["currentBranchId"]
    row = db.db.one(
        "SELECT id, timestamp FROM message WHERE threadId = :t AND branchId = :b AND timestamp = 1002",
        {"t": sample_thread, "b": main_id},
    )
    assert row
    result = branches.create_branch(
        sample_thread,
        None,
        "by-id",
        copy_mode="copy",
        parent_message_id=row["id"],
    )
    assert result["branchId"]
    assert len(result["messages"]) >= 3


# 1. Create branch from message
def test_create_branch_from_message(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    thread = db.get_thread(sample_thread)
    result = branches.create_branch(
        sample_thread, 1002, "experiment", copy_mode="copy", user=None
    )
    assert result["branchId"]
    assert len(result["messages"]) >= 3


# 2. Switch branches
def test_switch_branches(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    main_id = db.get_thread(sample_thread)["currentBranchId"]
    created = branches.create_branch(sample_thread, 1002, "alt", copy_mode="copy")
    alt_id = created["branchId"]
    switched = branches.switch_branch(sample_thread, main_id)
    assert switched["branchId"] == main_id
    assert switched.get("updatedAt")
    back = branches.switch_branch(sample_thread, alt_id)
    assert back["branchId"] == alt_id
    assert back.get("updatedAt")


def test_switch_after_create_updates_thread(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    main_id = db.get_thread(sample_thread)["currentBranchId"]
    branches.create_branch(sample_thread, 1002, "alt2", copy_mode="copy")
    switched = branches.switch_branch(sample_thread, main_id)
    assert switched["branchId"] == main_id
    assert switched.get("updatedAt")
    assert db.get_thread(sample_thread)["currentBranchId"] == main_id


# 3. Branch tree
def test_get_branch_tree(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branches.create_branch(sample_thread, 1002, "child", copy_mode="copy")
    tree = branches.get_branch_tree(sample_thread)
    assert tree["threadId"] == sample_thread
    assert len(tree["branches"]) >= 1


# 4. Delete branch including active
def test_delete_active_branch(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    created = branches.create_branch(sample_thread, 1002, "to-delete", copy_mode="copy")
    bid = created["branchId"]
    result = branches.delete_branch(bid)
    assert result["deletedBranchId"] == bid
    assert result["activeBranchId"] is not None


# 5. Merge branches
def test_merge_branches(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    main_id = db.get_thread(sample_thread)["currentBranchId"]
    child = branches.create_branch(sample_thread, 1002, "merge-src", copy_mode="copy")
    branches.append_message_to_branch(
        sample_thread,
        child["branchId"],
        {"role": "user", "content": "merge-me", "timestamp": 8000},
    )
    merged = branches.merge_branches(child["branchId"], main_id)
    assert merged["mergedCount"] >= 1
    assert "mergedCount" in merged


# 6. Branch diff
def test_branch_diff(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    main_id = db.get_thread(sample_thread)["currentBranchId"]
    child = branches.create_branch(sample_thread, 1002, "diff-child", copy_mode="copy")
    diff = branches.branch_diff(main_id, child["branchId"])
    assert "added" in diff and "removed" in diff


# 7. Fork thread
def test_fork_thread(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    result = run(branches.fork_thread_async(sample_thread))
    assert result["threadId"] != sample_thread
    forked = db.get_thread(result["threadId"])
    assert forked["parentId"] == sample_thread


# 8. Export branch
def test_export_branch_json(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branch_id = db.get_thread(sample_thread)["currentBranchId"]
    exported = branches.export_branch(branch_id)
    assert exported["version"] == 1
    assert exported["messages"]
    json.dumps(exported)


# 9. Import branch
def test_import_branch(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branch_id = db.get_thread(sample_thread)["currentBranchId"]
    payload = branches.export_branch(branch_id)
    payload["branch"]["name"] = "imported-copy"
    result = branches.import_branch(payload, thread_id=sample_thread)
    assert result["branchId"]
    assert result["messages"]


# 10. Tags
def test_branch_tags(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branch_id = db.get_thread(sample_thread)["currentBranchId"]
    updated = branches.update_tags(branch_id, add=["idea", "v2"], remove=[])
    assert "idea" in updated["tags"]


# 11. Search branches
def test_search_branches(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branches.create_branch(sample_thread, 1002, "searchable-name", copy_mode="copy")
    hits = branches.search_branches("searchable", take=10)
    assert any(h["name"] == "searchable-name" for h in hits)


# 12. Rewind root message id present
def test_branch_has_root_message(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branch_id = db.get_thread(sample_thread)["currentBranchId"]
    branch = db.db.one("SELECT rootMessageId FROM branch WHERE id = :id", {"id": branch_id})
    assert branch["rootMessageId"] is not None


# 14. Conflict detection
def test_concurrent_edit_conflict(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    thread = db.get_thread(sample_thread)
    stale = thread["updatedAt"]
    run(db.update_thread_async(sample_thread, {"title": "changed"}))
    assert branches.check_thread_conflict(sample_thread, stale) is True


# 15. Legacy migration
def test_legacy_thread_single_branch(temp_db):
    db, branches = temp_db

    async def create_legacy():
        return await db.create_thread_async(
            {"title": "legacy", "messages": [{"role": "user", "content": "old", "timestamp": 1}]}
        )

    tid = run(create_legacy())
    row = db.get_thread(tid)
    assert row.get("currentBranchId") is None
    branch_id = db.ensure_thread_branches(tid)
    assert branch_id
    row2 = db.get_thread(tid)
    assert row2["currentBranchId"] == branch_id
    tree = branches.get_branch_tree(tid)
    flat = []
    def walk(nodes):
        for n in nodes:
            flat.append(n)
            walk(n.get("children", []))
    walk(tree["branches"])
    assert len(flat) >= 1


# 21. Rename branch
def test_rename_branch(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    created = branches.create_branch(sample_thread, 1002, "rename-me", copy_mode="copy")
    result = branches.rename_branch(created["branchId"], "renamed")
    assert result["name"] == "renamed"


# 22. Messages only on current branch
def test_new_message_only_on_current_branch(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    main_id = db.get_thread(sample_thread)["currentBranchId"]
    alt = branches.create_branch(sample_thread, 1002, "isolated", copy_mode="copy")
    branches.switch_branch(sample_thread, alt["branchId"])
    branches.append_message_to_branch(
        sample_thread,
        alt["branchId"],
        {"role": "user", "content": "only here", "timestamp": 9000},
    )
    main_msgs = db.get_branch_messages(main_id)
    alt_msgs = db.get_branch_messages(alt["branchId"])
    assert not any(m.get("content") == "only here" for m in main_msgs)
    assert any(
        (m.get("content") == "only here" or m.get("content") == '"only here"')
        for m in alt_msgs
    )


# 23. Copy vs reference
def test_copy_mode_duplicates_messages(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    before = db.db.scalar("SELECT COUNT(*) FROM message WHERE threadId = :t", {"t": sample_thread})
    branches.create_branch(sample_thread, 1002, "copy", copy_mode="copy")
    after = db.db.scalar("SELECT COUNT(*) FROM message WHERE threadId = :t", {"t": sample_thread})
    assert after > before


def test_reference_mode_no_duplicate_rows(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    before = db.db.scalar("SELECT COUNT(*) FROM message WHERE threadId = :t", {"t": sample_thread})
    created = branches.create_branch(sample_thread, 1002, "ref", copy_mode="reference")
    after = db.db.scalar("SELECT COUNT(*) FROM message WHERE threadId = :t", {"t": sample_thread})
    rels = db.db.scalar(
        "SELECT COUNT(*) FROM message_relationship WHERE relationType = 'reference'"
    )
    assert after == before
    assert rels >= 1
    assert len(created["messages"]) >= 3


def test_reference_branch_loads_messages(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    created = branches.create_branch(sample_thread, 1002, "linked", copy_mode="reference")
    loaded = db.get_branch_messages(created["branchId"])
    assert len(loaded) >= 3
    assert any(m.get("timestamp") == 1002 for m in loaded)


# 25. Dual-write main branch
def test_dual_write_main_branch_json(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branch_id = db.get_thread(sample_thread)["currentBranchId"]
    msgs = [{"role": "user", "content": "synced", "timestamp": 5000}]
    branches.replace_branch_messages(sample_thread, branch_id, msgs)
    row = db.get_thread(sample_thread)
    stored = json.loads(row["messages"]) if isinstance(row["messages"], str) else row["messages"]
    assert stored[0]["content"] == "synced"


def test_default_branch_name(temp_db, sample_thread):
    db, branches = temp_db
    db.ensure_thread_branches(sample_thread)
    branch_id = db.get_thread(sample_thread)["currentBranchId"]
    branch = db.db.one("SELECT name FROM branch WHERE id = :id", {"id": branch_id})
    assert branch["name"] == DEFAULT_BRANCH_NAME
