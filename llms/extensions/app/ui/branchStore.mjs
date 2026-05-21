import { ref, computed } from 'vue'
import { appendQueryString } from '@servicestack/client'

const CHANNEL_NAME = 'llms.branches'

const currentBranchId = ref(null)
const branchesTree = ref({})
const dirtyBranches = ref(new Set())
const branchScrollPositions = new Map()
const lastDiff = ref(null)
const compareDraft = ref({ branchA: null, branchB: null })

let ctx = null
let ext = null
let channel = null

function setError(error, msg = null) {
    ctx?.setError(error, msg)
}

function scrollKey(threadId, branchId) {
    return `${threadId}:${branchId}`
}

function publish(event, payload) {
    if (!channel) return
    channel.postMessage({ event, payload, ts: Date.now() })
}

function handleChannelMessage(event) {
    const { event: type, payload } = event.data || {}
    if (!payload?.threadId) return

    switch (type) {
        case 'branch:switch':
            if (currentBranchId.value !== payload.branchId) {
                currentBranchId.value = payload.branchId
            }
            if (ctx?.threads?.currentThread?.value?.id === payload.threadId && payload.messages) {
                ctx.threads.replaceThread({
                    ...ctx.threads.currentThread.value,
                    messages: payload.messages,
                    currentBranchId: payload.branchId,
                    updatedAt: payload.updatedAt,
                })
            }
            break
        case 'branch:create':
            if (currentBranchId.value !== payload.branchId) {
                currentBranchId.value = payload.branchId
            }
            if (ctx?.threads?.currentThread?.value?.id === payload.threadId && payload.messages) {
                const t = ctx.threads.currentThread.value
                ctx.threads.replaceThread({
                    ...t,
                    messages: payload.messages,
                    currentBranchId: payload.branchId,
                    updatedAt: payload.updatedAt ?? t?.updatedAt,
                })
            }
            loadBranchTree(payload.threadId)
            break
        case 'branch:updated':
            loadBranchTree(payload.threadId)
            break
        case 'branch:dirty':
            if (payload.branchId) {
                dirtyBranches.value = new Set([...dirtyBranches.value, payload.branchId])
            }
            break
        case 'branch:clear-dirty':
            if (payload.branchId) {
                const next = new Set(dirtyBranches.value)
                next.delete(payload.branchId)
                dirtyBranches.value = next
            }
            break
    }
}

function initChannel() {
    if (typeof BroadcastChannel === 'undefined') return
    if (channel) return
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = handleChannelMessage
}

function saveScrollPosition(threadId, branchId, scrollTop) {
    if (threadId == null || branchId == null) return
    branchScrollPositions.set(scrollKey(threadId, branchId), scrollTop)
}

function getScrollPosition(threadId, branchId) {
    return branchScrollPositions.get(scrollKey(threadId, branchId)) ?? 0
}

function restoreScrollPosition(threadId, branchId, container) {
    if (!container) return
    const top = getScrollPosition(threadId, branchId)
    container.scrollTop = top
}

function showBranchPanel() {
    if (!ctx) return
    ctx.setLayout({ left: 'BranchPanel' })
    ctx.toggleLayout('left', true)
}

async function loadBranchTree(threadId) {
    if (!threadId) return null
    const api = await ext.getJson(`/branches/tree/${threadId}`)
    if (api.response) {
        branchesTree.value = { ...branchesTree.value, [threadId]: api.response }
        if (api.response.currentBranchId != null) {
            currentBranchId.value = api.response.currentBranchId
        }
        return api.response
    }
    setError(api.error, `Loading branch tree for thread ${threadId}`)
    return null
}

function markDirty(branchId) {
    if (!branchId) return
    dirtyBranches.value = new Set([...dirtyBranches.value, branchId])
    const threadId = ctx?.threads?.currentThread?.value?.id
    publish('branch:dirty', { threadId, branchId })
}

function clearDirty(branchId) {
    if (!branchId) return
    const next = new Set(dirtyBranches.value)
    next.delete(branchId)
    dirtyBranches.value = next
    const threadId = ctx?.threads?.currentThread?.value?.id
    publish('branch:clear-dirty', { threadId, branchId })
}

function isDirty(branchId) {
    return dirtyBranches.value.has(branchId)
}

async function confirmIfDirty(branchId) {
    if (!isDirty(branchId)) return true
    return globalThis.confirm?.(
        'This branch has unsent changes. Switch anyway?'
    ) ?? true
}

async function switchBranch(threadId, branchId, { scrollContainer = null } = {}) {
    const thread = ctx?.threads?.currentThread?.value
    const prevBranchId = currentBranchId.value ?? thread?.currentBranchId

    if (prevBranchId && !(await confirmIfDirty(prevBranchId))) {
        return null
    }

    if (scrollContainer && threadId && prevBranchId) {
        saveScrollPosition(threadId, prevBranchId, scrollContainer.scrollTop)
    }

    const body = {
        threadId,
        branchId,
        updatedAt: thread?.updatedAt,
    }
    const api = await ext.postJson('/branches/switch', body)
    if (!api.response) {
        if (api.error?.errorCode === 'Conflict' || api.response?.status === 409) {
            setError(api.error, 'Thread was modified in another tab')
        } else {
            setError(api.error, `Switching to branch ${branchId}`)
        }
        return null
    }

    currentBranchId.value = branchId
    clearDirty(prevBranchId)

    const updated = {
        ...thread,
        messages: api.response.messages,
        currentBranchId: branchId,
        updatedAt: api.response.updatedAt ?? thread?.updatedAt,
    }
    ctx.threads.replaceThread(updated)

    publish('branch:switch', {
        threadId,
        branchId,
        messages: api.response.messages,
        updatedAt: updated.updatedAt,
    })

    if (scrollContainer) {
        requestAnimationFrame(() => restoreScrollPosition(threadId, branchId, scrollContainer))
    }

    await loadBranchTree(threadId)
    return api.response
}

function flattenBranchTree(tree) {
    const out = []
    const walk = (nodes, depth = 0) => {
        for (const n of nodes || []) {
            out.push({ ...n, depth })
            walk(n.children, depth + 1)
        }
    }
    walk(tree?.branches)
    return out
}

function isDefaultMainBranch(node) {
    return node?.name === 'main' && (node?.tags || []).includes('__default__')
}

async function createBranch({ threadId, parentMessageId, messageId, name, copyMode = 'copy' }) {
    const body = { threadId, name, copyMode }
    if (messageId != null) body.messageId = messageId
    else if (parentMessageId != null) body.parentMessageId = parentMessageId
    const api = await ext.postJson('/branches/create', body)
    if (!api.response) {
        setError(api.error, 'Creating branch')
        return null
    }
    currentBranchId.value = api.response.branchId
    const thread = ctx.threads.currentThread.value
    ctx.threads.replaceThread({
        ...thread,
        messages: api.response.messages,
        currentBranchId: api.response.branchId,
        updatedAt: api.response.updatedAt ?? thread?.updatedAt,
    })
    publish('branch:create', {
        threadId,
        branchId: api.response.branchId,
        messages: api.response.messages,
        updatedAt: api.response.updatedAt ?? thread?.updatedAt,
    })
    await loadBranchTree(threadId)
    showBranchPanel()
    return api.response
}

async function deleteBranch(branchId) {
    if (!(await confirmIfDirty(branchId))) return null
    const api = await ext.deleteJson(`/branches/delete/${branchId}`)
    if (!api.response) {
        setError(api.error, `Deleting branch ${branchId}`)
        return null
    }
    const threadId = ctx?.threads?.currentThread?.value?.id
    if (api.response.activeBranchId) {
        currentBranchId.value = api.response.activeBranchId
    }
    if (threadId && api.response.messages) {
        ctx.threads.replaceThread({
            ...ctx.threads.currentThread.value,
            messages: api.response.messages,
            currentBranchId: api.response.activeBranchId,
        })
    }
    clearDirty(branchId)
    publish('branch:updated', { threadId, branchId })
    if (threadId) await loadBranchTree(threadId)
    return api.response
}

async function mergeBranches(sourceBranchId, targetBranchId) {
    const api = await ext.postJson('/branches/merge', { sourceBranchId, targetBranchId })
    if (!api.response) {
        setError(api.error, 'Merging branches')
        return null
    }
    const threadId = ctx?.threads?.currentThread?.value?.id
    if (threadId && api.response.messages) {
        ctx.threads.replaceThread({
            ...ctx.threads.currentThread.value,
            messages: api.response.messages,
        })
    }
    publish('branch:updated', { threadId, branchId: targetBranchId })
    if (threadId) await loadBranchTree(threadId)
    return api.response
}

async function getBranchDiff(branchA, branchB) {
    const api = await ext.getJson(appendQueryString('/branches/diff', { branchA, branchB }))
    if (api.response) {
        lastDiff.value = api.response
        return api.response
    }
    setError(api.error, 'Loading branch diff')
    return null
}

async function renameBranch(branchId, name) {
    const api = await ext.patchJson(`/branches/${branchId}`, { name })
    if (!api.response) {
        setError(api.error, 'Renaming branch')
        return null
    }
    const threadId = ctx?.threads?.currentThread?.value?.id
    publish('branch:updated', { threadId, branchId })
    if (threadId) await loadBranchTree(threadId)
    return api.response
}

async function updateTags(branchId, add = [], remove = []) {
    const api = await ext.postJson('/branches/tags', { branchId, add, remove })
    if (!api.response) {
        setError(api.error, 'Updating branch tags')
        return null
    }
    const threadId = ctx?.threads?.currentThread?.value?.id
    if (threadId) await loadBranchTree(threadId)
    return api.response
}

async function searchBranches(q, take = 50) {
    const api = await ext.getJson(appendQueryString('/branches/search', { q, take }))
    return api.response || []
}

async function forkThread(threadId, branchId = null) {
    const api = await ext.postJson(`/branches/fork/${threadId}`, branchId ? { branchId } : {})
    if (!api.response) {
        setError(api.error, 'Forking thread')
        return null
    }
    return api.response
}

async function exportBranch(branchId) {
    const api = await ext.postJson(`/branches/export/${branchId}`)
    return api.response || null
}

async function importBranch(payload, threadId = null) {
    const api = await ext.postJson('/branches/import', { ...payload, threadId })
    if (!api.response) {
        setError(api.error, 'Importing branch')
        return null
    }
    const tid = threadId ?? ctx?.threads?.currentThread?.value?.id
    if (tid) {
        await loadBranchTree(tid)
        if (api.response.branchId) {
            await switchBranch(tid, api.response.branchId)
        }
    }
    return api.response
}

function openBranchCompare(branchA = null, branchB = null) {
    compareDraft.value = {
        branchA: branchA ?? currentBranchId.value,
        branchB: branchB ?? null,
    }
    ctx?.openModal?.('BranchCompare')
}

async function runBranchCompare(branchA, branchB) {
    if (branchA == null || branchB == null || branchA === branchB) {
        ctx?.toast?.('Select two different branches')
        return null
    }
    const diff = await getBranchDiff(branchA, branchB)
    if (diff) {
        ctx?.closeModal?.('BranchCompare')
        ctx?.openModal?.('DiffViewer')
    }
    return diff
}

async function downloadBranchExport(branchId) {
    const data = await exportBranch(branchId)
    if (!data) return null
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `branch-${branchId}.json`
    a.click()
    URL.revokeObjectURL(url)
    ctx?.toast?.('Branch exported')
    return data
}

async function importBranchFromFile(file, threadId = null) {
    if (!file) return null
    const text = await file.text()
    const payload = JSON.parse(text)
    return importBranch(payload, threadId)
}

function rewindToBranchRoot(scrollContainer = null) {
    const thread = ctx?.threads?.currentThread?.value
    const tree = branchesTree.value[thread?.id]
    if (!tree?.branches?.length) return

    const findBranch = (nodes, id) => {
        for (const node of nodes) {
            if (node.id === id) return node
            const child = findBranch(node.children || [], id)
            if (child) return child
        }
        return null
    }

    const branch = findBranch(tree.branches, currentBranchId.value)
    const rootTs = branch?.rootMessageTimestamp ?? branch?.rootMessageId
    if (!scrollContainer) return

    if (rootTs != null) {
        const el = scrollContainer.querySelector(`[data-message-id="${rootTs}"]`)
            || scrollContainer.querySelector(`[data-timestamp="${rootTs}"]`)
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            return
        }
    }
    scrollContainer.scrollTop = 0
}

const currentBranchTree = computed(() => {
    const threadId = ctx?.threads?.currentThread?.value?.id
    return threadId ? branchesTree.value[threadId] : null
})

export function useBranchStore() {
    return {
        currentBranchId,
        branchesTree,
        dirtyBranches,
        lastDiff,
        compareDraft,
        currentBranchTree,
        flattenBranchTree,
        isDefaultMainBranch,
        loadBranchTree,
        switchBranch,
        createBranch,
        deleteBranch,
        mergeBranches,
        getBranchDiff,
        renameBranch,
        updateTags,
        searchBranches,
        forkThread,
        exportBranch,
        importBranch,
        openBranchCompare,
        runBranchCompare,
        downloadBranchExport,
        importBranchFromFile,
        markDirty,
        clearDirty,
        isDirty,
        saveScrollPosition,
        restoreScrollPosition,
        rewindToBranchRoot,
        showBranchPanel,
    }
}

export default {
    install(context) {
        ctx = context
        ext = ctx.scope('app')
        initChannel()
        const store = useBranchStore()
        ctx.setGlobals({ branches: store })
        ctx.setState({
            currentBranchId: store.currentBranchId,
            branchesTree: store.branchesTree,
            dirtyBranches: store.dirtyBranches,
        })
    },
}
