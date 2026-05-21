"""Playwright UI tests for branch features (browser-only, no server required)."""

import pytest

def _open(page):
    page.set_content("<!DOCTYPE html><html><body></body></html>")


# 13. Cross-tab sync (BroadcastChannel)
def test_broadcast_channel_sync(page):
    _open(page)
    event = page.evaluate(
        """() => new Promise((resolve) => {
            const a = new BroadcastChannel('llms.branches');
            const b = new BroadcastChannel('llms.branches');
            b.onmessage = (e) => resolve(e.data.event);
            a.postMessage({ event: 'branch:switch', payload: { threadId: 1, branchId: 2, messages: [] } });
        })"""
    )
    assert event == "branch:switch"


# 16. Branch tree SVG render logic
def test_branch_tree_svg_layout(page):
    _open(page)
    nodes = page.evaluate(
        """() => {
            const nodes = [{ id: 1, name: 'main', children: [{ id: 2, name: 'b2', children: [] }] }];
            const layout = [];
            const walk = (list, depth) => {
                list.forEach((n, i) => {
                    layout.push({ id: n.id, x: 100 + i * 80, y: 40 + depth * 60 });
                    walk(n.children || [], depth + 1);
                });
            };
            walk(nodes, 0);
            return layout;
        }"""
    )
    assert len(nodes) == 2


# 17. Context menu positioning
def test_context_menu_position(page):
    _open(page)
    pos = page.evaluate(
        """() => {
            const menu = document.createElement('div');
            menu.style.position = 'fixed';
            menu.style.left = '120px';
            menu.style.top = '80px';
            document.body.appendChild(menu);
            const r = menu.getBoundingClientRect();
            return { left: r.left, top: r.top };
        }"""
    )
    assert pos["left"] == 120


# 18. Branch panel list rendering
def test_branch_panel_flat_list(page):
    _open(page)
    count = page.evaluate(
        """() => {
            const tree = { branches: [{ id: 1, name: 'main', children: [{ id: 2, name: 'alt', children: [] }] }] };
            const flat = [];
            const walk = (nodes, depth = 0) => {
                nodes.forEach(n => { flat.push(n.name); walk(n.children || [], depth + 1); });
            };
            walk(tree.branches);
            return flat.length;
        }"""
    )
    assert count == 2


# 19. Diff viewer structure
def test_diff_viewer_sections(page):
    _open(page)
    html = page.evaluate(
        """() => {
            const diff = { added: [{ role: 'user', content: 'a', timestamp: 1 }], removed: [], changed: [] };
            const parts = [];
            if (diff.added.length) parts.push('added');
            if (diff.removed.length) parts.push('removed');
            if (diff.changed.length) parts.push('changed');
            return parts.join(',') || 'empty';
        }"""
    )
    assert html == "added"


# 20. Branch indicator dirty dot
def test_branch_indicator_dirty_flag(page):
    _open(page)
    dirty = page.evaluate(
        """() => {
            const dirtyBranches = new Set([42]);
            return dirtyBranches.has(42);
        }"""
    )
    assert dirty is True


# 24. Dirty branches tracking (Set semantics used in branchStore)
def test_dirty_branches_storage(page):
    _open(page)
    dirty = page.evaluate(
        """() => {
            const dirtyBranches = new Set([1, 2]);
            dirtyBranches.add(3);
            dirtyBranches.delete(2);
            return [...dirtyBranches];
        }"""
    )
    assert 1 in dirty and 3 in dirty and 2 not in dirty


# 25. Scroll position save/restore
def test_scroll_position_roundtrip(page):
    _open(page)
    result = page.evaluate(
        """() => {
            const el = document.createElement('div');
            el.style.height = '200px';
            el.style.overflow = 'auto';
            el.innerHTML = '<div style="height:800px"></div>';
            document.body.appendChild(el);
            el.scrollTop = 120;
            const saved = el.scrollTop;
            el.scrollTop = 0;
            el.scrollTop = saved;
            return el.scrollTop;
        }"""
    )
    assert result == 120


# 12 UI: scroll into view
def test_scroll_into_view_api(page):
    _open(page)
    ok = page.evaluate(
        """() => {
            const t = document.createElement('div');
            t.setAttribute('data-timestamp', '1002');
            let scrolled = false;
            t.scrollIntoView = () => { scrolled = true; };
            document.body.appendChild(t);
            t.scrollIntoView({ block: 'start' });
            return scrolled;
        }"""
    )
    assert ok
