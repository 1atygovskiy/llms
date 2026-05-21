import { ref, computed, watch, inject } from 'vue'

export const BranchPanel = {
    template: `
        <div class="flex flex-col h-full text-sm" :class="$styles.text">
            <div class="px-3 py-2 border-b font-semibold" :class="$styles.chromeBorder">Branches</div>
            <div class="flex-1 overflow-y-auto p-2 space-y-1">
                <template v-for="node in flatBranches" :key="node.id">
                    <button type="button"
                        class="w-full text-left px-2 py-1.5 rounded-md transition-colors flex items-center gap-2"
                        :class="node.id === currentBranchId ? $styles.threadItemActive : $styles.threadItem"
                        :style="{ paddingLeft: (8 + node.depth * 12) + 'px' }"
                        @click="selectBranch(node.id)">
                        <span class="truncate flex-1">{{ node.name }}</span>
                        <span v-if="isDirty(node.id)" class="size-1.5 rounded-full bg-amber-500 shrink-0"></span>
                        <span class="text-xs opacity-60">{{ node.messageCount }}</span>
                    </button>
                </template>
                <div v-if="!flatBranches.length" class="px-2 py-4 text-xs opacity-60">No branches yet</div>
            </div>
            <div class="p-2 border-t space-y-2" :class="$styles.chromeBorder">
                <input v-model="searchQ" type="search" placeholder="Search branches..."
                    class="w-full px-2 py-1 rounded border text-xs" :class="$styles.chromeBorder" />
                <div v-if="searchResults.length" class="max-h-24 overflow-y-auto space-y-1">
                    <button v-for="r in searchResults" :key="r.branchId" type="button"
                        class="w-full text-left px-2 py-1 rounded text-xs hover:opacity-80"
                        @click="goToSearchResult(r)">
                        {{ r.threadTitle }} / {{ r.name }}
                    </button>
                </div>
            </div>
        </div>
    `,
    setup() {
        const ctx = inject('ctx')
        const branches = globalThis.$branches
        const searchQ = ref('')
        const searchResults = ref([])

        const currentBranchId = computed(() => branches?.currentBranchId?.value)

        const flatBranches = computed(() => {
            const tree = branches?.currentBranchTree?.value
            const out = []
            const walk = (nodes, depth = 0) => {
                for (const n of nodes || []) {
                    out.push({ ...n, depth })
                    walk(n.children, depth + 1)
                }
            }
            walk(tree?.branches)
            return out
        })

        async function selectBranch(branchId) {
            const thread = ctx.threads?.currentThread?.value
            if (!thread) return
            await branches.switchBranch(thread.id, branchId)
        }

        function isDirty(id) {
            return branches?.isDirty?.(id)
        }

        let searchTimer
        watch(searchQ, (q) => {
            clearTimeout(searchTimer)
            if (!q?.trim()) {
                searchResults.value = []
                return
            }
            searchTimer = setTimeout(async () => {
                searchResults.value = await branches.searchBranches(q.trim())
            }, 300)
        })

        function goToSearchResult(r) {
            ctx.to(`/c/${r.threadId}`)
        }

        watch(
            () => ctx.threads?.currentThread?.value?.id,
            (id) => {
                if (id) branches.loadBranchTree(id)
            },
            { immediate: true },
        )

        return {
            flatBranches,
            currentBranchId,
            selectBranch,
            isDirty,
            searchQ,
            searchResults,
            goToSearchResult,
        }
    },
}

export default BranchPanel
