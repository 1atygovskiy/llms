import { ref, computed, watch, inject } from 'vue'

const DEFAULT_TAG = '__default__'

export const BranchPanel = {
    template: `
        <div class="flex flex-col h-full text-sm" :class="$styles.text">
            <div class="px-3 py-2 border-b font-semibold flex items-center justify-between gap-2" :class="$styles.chromeBorder">
                <span>Branches</span>
                <span v-if="flatBranches.length" class="text-xs font-normal opacity-60">{{ flatBranches.length }}</span>
            </div>
            <div class="flex-1 overflow-y-auto p-2 space-y-1">
                <template v-for="node in flatBranches" :key="node.id">
                    <div class="flex items-center gap-1">
                        <button type="button"
                            class="flex-1 text-left px-2 py-1.5 rounded-md transition-colors flex items-center gap-2 min-w-0"
                            :class="node.id === currentBranchId ? $styles.threadItemActive : $styles.threadItem"
                            :style="{ paddingLeft: (8 + node.depth * 12) + 'px' }"
                            @click="selectBranch(node.id)">
                            <span class="truncate flex-1">{{ node.name }}</span>
                            <span v-if="isDirty(node.id)" class="size-1.5 rounded-full bg-amber-500 shrink-0"></span>
                            <span class="text-xs opacity-60">{{ node.messageCount }}</span>
                        </button>
                        <button type="button" class="shrink-0 px-1 opacity-50 hover:opacity-100 text-xs"
                            title="Manage branch"
                            @click.stop="setManage(node)">⋯</button>
                    </div>
                </template>
                <div v-if="!flatBranches.length" class="px-2 py-4 text-xs opacity-60">No branches yet</div>
            </div>

            <div v-if="manageBranch" class="p-2 border-t space-y-2" :class="$styles.chromeBorder">
                <div class="text-xs font-medium opacity-80">Manage: {{ manageBranch.name }}</div>
                <div class="flex gap-1">
                    <input v-model="renameName" type="text" class="flex-1 px-2 py-1 rounded border text-xs min-w-0"
                        :class="$styles.chromeBorder" :disabled="isMain(manageBranch)" />
                    <button type="button" class="px-2 py-1 rounded text-xs border shrink-0"
                        :class="$styles.chromeBorder"
                        :disabled="isMain(manageBranch) || !renameName.trim()"
                        @click="doRename">Rename</button>
                </div>
                <div class="flex gap-1 items-center">
                    <input v-model="tagsInput" type="text" placeholder="tags (comma-separated)"
                        class="flex-1 px-2 py-1 rounded border text-xs min-w-0" :class="$styles.chromeBorder" />
                    <button type="button" class="px-2 py-1 rounded text-xs border shrink-0"
                        :class="$styles.chromeBorder" @click="doTags">Tags</button>
                </div>
                <div class="flex gap-1 items-center">
                    <select v-model.number="mergeTargetId" class="flex-1 px-2 py-1 rounded border text-xs min-w-0"
                        :class="$styles.chromeBorder">
                        <option :value="null" disabled>Merge into…</option>
                        <option v-for="b in mergeTargets" :key="b.id" :value="b.id">{{ b.name }}</option>
                    </select>
                    <button type="button" class="px-2 py-1 rounded text-xs border shrink-0"
                        :class="$styles.chromeBorder"
                        :disabled="!mergeTargetId"
                        @click="doMerge">Merge</button>
                </div>
                <div class="flex flex-wrap gap-1">
                    <button type="button" class="px-2 py-1 rounded text-xs border" :class="$styles.chromeBorder"
                        @click="doCompare(manageBranch.id)">Compare</button>
                    <button type="button" class="px-2 py-1 rounded text-xs border" :class="$styles.chromeBorder"
                        @click="doExport(manageBranch.id)">Export</button>
                    <button type="button" class="px-2 py-1 rounded text-xs border text-red-600 dark:text-red-400"
                        :class="$styles.chromeBorder"
                        :disabled="isMain(manageBranch)"
                        @click="doDelete">Delete</button>
                </div>
            </div>

            <div class="p-2 border-t space-y-2" :class="$styles.chromeBorder">
                <div class="flex flex-wrap gap-1">
                    <button type="button" class="px-2 py-1 rounded text-xs border" :class="$styles.chromeBorder"
                        @click="openCompare">Compare branches</button>
                    <button type="button" class="px-2 py-1 rounded text-xs border" :class="$styles.chromeBorder"
                        @click="doFork">Fork dialog</button>
                    <label class="px-2 py-1 rounded text-xs border cursor-pointer" :class="$styles.chromeBorder">
                        Import
                        <input type="file" accept="application/json,.json" class="hidden" @change="onImport" />
                    </label>
                </div>
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
        const manageBranch = ref(null)
        const renameName = ref('')
        const tagsInput = ref('')
        const mergeTargetId = ref(null)

        const currentBranchId = computed(() => branches?.currentBranchId?.value)

        const flatBranches = computed(() =>
            branches.flattenBranchTree(branches?.currentBranchTree?.value),
        )

        const mergeTargets = computed(() => {
            const id = manageBranch.value?.id
            return flatBranches.value.filter((b) => b.id !== id)
        })

        function isMain(node) {
            return branches.isDefaultMainBranch(node)
                || (node?.name === 'main' && (node?.tags || []).includes(DEFAULT_TAG))
        }

        function isDirty(id) {
            return branches?.isDirty?.(id)
        }

        async function selectBranch(branchId) {
            const thread = ctx.threads?.currentThread?.value
            if (!thread) return
            await branches.switchBranch(thread.id, branchId)
        }

        function setManage(node) {
            manageBranch.value = node
            renameName.value = node.name
            tagsInput.value = (node.tags || []).join(', ')
            mergeTargetId.value = null
        }

        async function doRename() {
            if (!manageBranch.value) return
            await branches.renameBranch(manageBranch.value.id, renameName.value.trim())
        }

        async function doTags() {
            if (!manageBranch.value) return
            const desired = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean)
            const current = manageBranch.value.tags || []
            const add = desired.filter((t) => !current.includes(t))
            const remove = current.filter((t) => !desired.includes(t))
            await branches.updateTags(manageBranch.value.id, add, remove)
        }

        async function doMerge() {
            if (!manageBranch.value || !mergeTargetId.value) return
            if (!confirm(`Merge "${manageBranch.value.name}" into selected branch?`)) return
            await branches.mergeBranches(manageBranch.value.id, mergeTargetId.value)
            mergeTargetId.value = null
        }

        async function doDelete() {
            if (!manageBranch.value || isMain(manageBranch.value)) return
            if (!confirm(`Delete branch "${manageBranch.value.name}"?`)) return
            await branches.deleteBranch(manageBranch.value.id)
            manageBranch.value = null
        }

        function doCompare(branchId) {
            branches.openBranchCompare(currentBranchId.value, branchId)
        }

        function openCompare() {
            branches.openBranchCompare()
        }

        async function doExport(branchId) {
            await branches.downloadBranchExport(branchId ?? currentBranchId.value)
        }

        async function doFork() {
            const thread = ctx.threads?.currentThread?.value
            if (!thread) return
            const res = await branches.forkThread(thread.id, currentBranchId.value)
            if (res?.threadId) ctx.to(`/c/${res.threadId}`)
        }

        async function onImport(ev) {
            const file = ev.target?.files?.[0]
            ev.target.value = ''
            const thread = ctx.threads?.currentThread?.value
            if (!file || !thread) return
            try {
                await branches.importBranchFromFile(file, thread.id)
                ctx.toast('Branch imported')
            } catch (e) {
                ctx.toast('Invalid branch JSON')
            }
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
                manageBranch.value = null
            },
            { immediate: true },
        )

        return {
            flatBranches,
            currentBranchId,
            manageBranch,
            renameName,
            tagsInput,
            mergeTargetId,
            mergeTargets,
            selectBranch,
            setManage,
            isMain,
            isDirty,
            doRename,
            doTags,
            doMerge,
            doDelete,
            doCompare,
            openCompare,
            doExport,
            doFork,
            onImport,
            searchQ,
            searchResults,
            goToSearchResult,
        }
    },
}

export default BranchPanel
