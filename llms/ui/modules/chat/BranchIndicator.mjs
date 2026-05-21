import { computed, inject } from 'vue'

function flattenBranches(nodes, depth = 0, out = []) {
    for (const n of nodes || []) {
        out.push({ ...n, depth })
        flattenBranches(n.children, depth + 1, out)
    }
    return out
}

export const BranchIndicator = {
    template: `
        <div v-if="flatBranches.length" class="inline-flex items-center gap-2 flex-wrap">
            <label class="sr-only">Current branch</label>
            <select
                :value="currentBranchId ?? ''"
                @change="onBranchSelect"
                class="text-xs rounded-md border px-2 py-1 max-w-[12rem] truncate"
                :class="[$styles.chromeBorder, $styles.dropdownButton]"
                :title="branchTitle"
            >
                <option v-for="b in flatBranches" :key="b.id" :value="b.id">
                    {{ indent(b.depth) }}{{ b.name }} ({{ b.messageCount }})
                </option>
            </select>
            <button type="button"
                class="text-xs px-2 py-1 rounded-md border transition-colors"
                :class="[$styles.chromeBorder, $styles.linkHover]"
                title="Open branch list"
                @click="openBranches">
                Branches
            </button>
            <button type="button"
                class="text-xs px-2 py-1 rounded-md border transition-colors"
                :class="[$styles.chromeBorder, $styles.linkHover]"
                title="Branch map"
                @click="openBranchMap">
                Map
            </button>
            <span v-if="isDirty" class="size-2 rounded-full bg-amber-500 shrink-0" title="Unsent changes"></span>
        </div>
    `,
    setup() {
        const ctx = inject('ctx')
        const branches = globalThis.$branches
        const currentBranchId = branches?.currentBranchId

        const flatBranches = computed(() => {
            const tree = branches?.currentBranchTree?.value
            return flattenBranches(tree?.branches)
        })

        const branchTitle = computed(() => {
            const id = currentBranchId?.value
            const b = flatBranches.value.find(x => x.id === id)
            return b ? `${b.name} · ${b.messageCount} messages` : 'Branches'
        })

        const isDirty = computed(() => {
            const id = currentBranchId?.value
            return id != null && branches?.isDirty?.(id)
        })

        function indent(depth) {
            return depth > 0 ? '— '.repeat(depth) : ''
        }

        async function onBranchSelect(e) {
            const branchId = parseInt(e.target.value, 10)
            const thread = ctx?.threads?.currentThread?.value
            if (!thread || !branchId || branchId === currentBranchId?.value) return
            await branches.switchBranch(thread.id, branchId, {
                scrollContainer: document.getElementById('messages'),
            })
        }

        function openBranches() {
            branches?.showBranchPanel?.()
        }

        function openBranchMap() {
            ctx.setLayout({ left: 'BranchTree' })
            ctx.toggleLayout('left', true)
        }

        return {
            flatBranches,
            currentBranchId,
            branchTitle,
            isDirty,
            indent,
            onBranchSelect,
            openBranches,
            openBranchMap,
        }
    },
}

export default BranchIndicator
