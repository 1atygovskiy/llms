import { ref, computed, watch } from 'vue'

export const BranchCompare = {
    template: `
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="$ctx.closeModal('BranchCompare')">
            <div class="w-full max-w-md rounded-lg border shadow-xl p-4 space-y-4"
                :class="[$styles.bgBody, $styles.chromeBorder]">
                <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold" :class="$styles.heading">Compare branches</h2>
                    <button type="button" class="p-1 rounded hover:opacity-70" @click="$ctx.closeModal('BranchCompare')">✕</button>
                </div>
                <label class="block text-xs opacity-70">Branch A</label>
                <select v-model.number="branchA" class="w-full px-2 py-1.5 rounded border text-sm" :class="$styles.chromeBorder">
                    <option v-for="b in options" :key="'a'+b.id" :value="b.id">{{ indent(b.depth) }}{{ b.name }}</option>
                </select>
                <label class="block text-xs opacity-70">Branch B</label>
                <select v-model.number="branchB" class="w-full px-2 py-1.5 rounded border text-sm" :class="$styles.chromeBorder">
                    <option :value="null" disabled>Select branch</option>
                    <option v-for="b in options" :key="'b'+b.id" :value="b.id">{{ indent(b.depth) }}{{ b.name }}</option>
                </select>
                <div class="flex justify-end gap-2">
                    <button type="button" class="px-3 py-1.5 rounded text-sm opacity-70" @click="$ctx.closeModal('BranchCompare')">Cancel</button>
                    <button type="button" class="px-3 py-1.5 rounded text-sm font-medium border"
                        :class="$styles.threadItemActive"
                        :disabled="!branchA || !branchB || branchA === branchB"
                        @click="compare">Compare</button>
                </div>
            </div>
        </div>
    `,
    setup() {
        const branches = globalThis.$branches
        const branchA = ref(null)
        const branchB = ref(null)

        const options = computed(() => branches.flattenBranchTree(branches.currentBranchTree.value))

        watch(
            () => branches.compareDraft?.value,
            (d) => {
                if (!d) return
                branchA.value = d.branchA ?? branches.currentBranchId?.value
                branchB.value = d.branchB ?? null
            },
            { immediate: true, deep: true },
        )

        function indent(depth) {
            return depth ? '  '.repeat(depth) : ''
        }

        async function compare() {
            await branches.runBranchCompare(branchA.value, branchB.value)
        }

        return { branchA, branchB, options, indent, compare }
    },
}

export default BranchCompare
