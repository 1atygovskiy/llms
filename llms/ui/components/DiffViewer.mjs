import { computed } from 'vue'

export const DiffViewer = {
    template: `
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="$ctx.closeModal('DiffViewer')">
            <div class="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-lg border shadow-xl"
                :class="[$styles.bgBody, $styles.chromeBorder]">
                <div class="flex items-center justify-between px-4 py-3 border-b" :class="$styles.chromeBorder">
                    <h2 class="text-lg font-semibold" :class="$styles.heading">Branch comparison</h2>
                    <button type="button" class="p-1 rounded hover:opacity-70" @click="$ctx.closeModal('DiffViewer')">✕</button>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                    <section v-if="diff?.added?.length">
                        <h3 class="font-medium text-green-600 dark:text-green-400 mb-1">Added ({{ diff.added.length }})</h3>
                        <div v-for="(m, i) in diff.added" :key="'a'+i" class="p-2 rounded border mb-1" :class="$styles.chromeBorder">
                            <div class="text-xs opacity-60">{{ m.role }} · {{ m.timestamp }}</div>
                            <div class="truncate">{{ preview(m) }}</div>
                        </div>
                    </section>
                    <section v-if="diff?.removed?.length">
                        <h3 class="font-medium text-red-600 dark:text-red-400 mb-1">Removed ({{ diff.removed.length }})</h3>
                        <div v-for="(m, i) in diff.removed" :key="'r'+i" class="p-2 rounded border mb-1" :class="$styles.chromeBorder">
                            <div class="text-xs opacity-60">{{ m.role }} · {{ m.timestamp }}</div>
                            <div class="truncate">{{ preview(m) }}</div>
                        </div>
                    </section>
                    <section v-if="diff?.changed?.length">
                        <h3 class="font-medium text-amber-600 dark:text-amber-400 mb-1">Changed ({{ diff.changed.length }})</h3>
                        <div v-for="(c, i) in diff.changed" :key="'c'+i" class="p-2 rounded border mb-2 space-y-1" :class="$styles.chromeBorder">
                            <div class="text-xs opacity-60">timestamp {{ c.timestamp }}</div>
                            <div class="grid grid-cols-2 gap-2">
                                <div><span class="text-xs font-medium">A</span><div class="truncate">{{ preview(c.branchA) }}</div></div>
                                <div><span class="text-xs font-medium">B</span><div class="truncate">{{ preview(c.branchB) }}</div></div>
                            </div>
                        </div>
                    </section>
                    <p v-if="!hasChanges" class="opacity-60 text-center py-8">No differences</p>
                </div>
            </div>
        </div>
    `,
    setup() {
        const branches = globalThis.$branches
        const diff = computed(() => branches?.lastDiff?.value)

        const hasChanges = computed(() => {
            const d = diff.value
            return d && ((d.added?.length || 0) + (d.removed?.length || 0) + (d.changed?.length || 0) > 0)
        })

        function preview(m) {
            const c = m?.content
            if (typeof c === 'string') return c.slice(0, 120)
            if (Array.isArray(c)) return c.map(x => x.text || '').join(' ').slice(0, 120)
            return JSON.stringify(c || '').slice(0, 120)
        }

        return { diff, hasChanges, preview }
    },
}

export default DiffViewer
