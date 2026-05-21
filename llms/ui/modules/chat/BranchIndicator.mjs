import { computed, inject } from 'vue'

export const BranchIndicator = {
    template: `
        <div v-if="branchName" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border"
            :class="[$styles.muted, $styles.chromeBorder]"
            :title="branchTitle">
            <svg class="size-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><path d="M18 6v9"/><circle cx="18" cy="18" r="3"/>
            </svg>
            <span class="font-medium max-w-[10rem] truncate">{{ branchName }}</span>
            <span v-if="isDirty" class="size-1.5 rounded-full bg-amber-500" title="Unsent changes"></span>
        </div>
    `,
    setup() {
        const branches = globalThis.$branches
        const currentBranchId = branches?.currentBranchId

        const branchName = computed(() => {
            const tree = branches?.currentBranchTree?.value
            const id = currentBranchId?.value
            if (!tree || id == null) return null
            const find = (nodes) => {
                for (const n of nodes || []) {
                    if (n.id === id) return n.name
                    const c = find(n.children)
                    if (c) return c
                }
                return null
            }
            return find(tree.branches) || 'main'
        })

        const isDirty = computed(() => {
            const id = currentBranchId?.value
            return id != null && branches?.isDirty?.(id)
        })

        const branchTitle = computed(() => {
            const tags = []
            if (isDirty.value) tags.push('unsent changes')
            return tags.length ? `${branchName.value} (${tags.join(', ')})` : branchName.value
        })

        return { branchName, isDirty, branchTitle }
    },
}

export default BranchIndicator
