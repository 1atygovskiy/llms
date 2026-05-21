import { ref, computed } from 'vue'
import { appendQueryString } from '@servicestack/client'

const CHANNEL_NAME = 'llms.branches'

const currentBranchId = ref(null)
const branchesTree = ref({})
const dirtyBranches = ref(new Set())
const branchScrollPositions = new Map()
const lastDiff = ref(null)

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

async function createBranch({ threadId, parentMessageId, name, copyMode = 'copy' }) {
    const api = await ext.postJson('/branches/create', {
        body: JSON.stringify({
            threadId,
            parentMessageId,
            name,
            copyMode,
        }),
    })
    if (!api.response) {
        setError(api.error, 'Creating branch')
        return null
    }
    currentBranchId.value = api.response.branchId
    ctx.threads.replaceThread({
        ...ctx.threads.currentThread.value,
        messages: api.response.messages,
        currentBranchId: api.response.branchId,
    })
    publish('branch:create', { threadId, branchId: api.response.branchId })
    await loadBranchTree(threadId)
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
    const api = await ext.postJson('/branches/merge', {
        body: JSON.stringify({ sourceBranchId, targetBranchId }),
    })
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
    const api = await ext.postJson('/branches/tags', {
        body: JSON.stringify({ branchId, add, remove }),
    })
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
    const api = await ext.postJson(`/branches/fork/${threadId}`, {
        body: JSON.stringify(branchId ? { branchId } : {}),
    })
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
    const api = await ext.postJson('/branches/import', {
        body: JSON.stringify({ ...payload, threadId }),
    })
    if (!api.response) {
        setError(api.error, 'Importing branch')
        return null
    }
    return api.response
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
    const rootTs = branch?.rootMessageId
    if (!scrollContainer) return

    if (rootTs) {
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
        currentBranchTree,
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
        markDirty,
        clearDirty,
        isDirty,
        saveScrollPosition,
        restoreScrollPosition,
        rewindToBranchRoot,
    }
}

export default {
    install(context) {
        ctx = context
        ext = ctx.scope('app')
        initChannel()
        ctx.setGlobals({ branches: useBranchStore() })
    },
}
