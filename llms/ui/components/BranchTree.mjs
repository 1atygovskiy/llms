import { ref, watch, onMounted, onUnmounted, computed } from 'vue'

export const BranchTree = {
    template: `
        <div class="flex flex-col h-full">
            <div class="flex items-center justify-between px-2 py-1 border-b text-xs" :class="$styles.chromeBorder">
                <span>Branch map</span>
                <div class="flex gap-1">
                    <button type="button" class="px-1.5 rounded border" :class="$styles.chromeBorder" @click="zoomIn">+</button>
                    <button type="button" class="px-1.5 rounded border" :class="$styles.chromeBorder" @click="zoomOut">−</button>
                    <button type="button" class="px-1.5 rounded border" :class="$styles.chromeBorder" @click="resetView">⟲</button>
                </div>
            </div>
            <div ref="viewport" class="flex-1 overflow-hidden cursor-grab active:cursor-grabbing bg-transparent"
                @wheel.prevent="onWheel" @mousedown="onPanStart">
                <svg ref="svg" class="block" :width="width" :height="height" :viewBox="viewBox">
                    <g :transform="transform">
                        <path v-for="(edge, i) in edges" :key="'e'+i"
                            :d="edge.d" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5" />
                        <g v-for="node in layoutNodes" :key="node.id" @click.stop="selectNode(node)"
                            class="cursor-pointer">
                            <rect :x="node.x - 50" :y="node.y - 16" width="100" height="32" rx="8"
                                :class="node.id === currentBranchId ? 'fill-blue-500/20 stroke-blue-500' : 'fill-transparent stroke-current'"
                                stroke-width="1.5" stroke-opacity="0.5" />
                            <text :x="node.x" :y="node.y + 4" text-anchor="middle" class="text-[11px] fill-current">
                                {{ node.name }}
                            </text>
                        </g>
                    </g>
                </svg>
            </div>
        </div>
    `,
    setup() {
        const branches = globalThis.$branches
        const ctx = globalThis.$ctx
        const width = ref(400)
        const height = ref(300)
        const scale = ref(1)
        const panX = ref(0)
        const panY = ref(0)
        const viewport = ref(null)
        const svg = ref(null)

        const layoutNodes = ref([])
        const edges = ref([])

        const currentBranchId = computed(() => branches?.currentBranchId?.value)

        const viewBox = computed(() => `0 0 ${width.value} ${height.value}`)
        const transform = computed(() => `translate(${panX.value},${panY.value}) scale(${scale.value})`)

        function layoutTree(tree) {
            const nodes = []
            const links = []
            const levelY = 70
            const nodeGap = 120

            const walk = (list, depth, parent = null) => {
                const count = list?.length || 0
                list?.forEach((n, i) => {
                    const x = width.value / 2 + (i - (count - 1) / 2) * nodeGap + depth * 20
                    const y = 40 + depth * levelY
                    nodes.push({ id: n.id, name: n.name, x, y })
                    if (parent) {
                        links.push({
                            d: `M ${parent.x} ${parent.y + 16} C ${parent.x} ${(parent.y + y) / 2}, ${x} ${(parent.y + y) / 2}, ${x} ${y - 16}`,
                        })
                    }
                    walk(n.children, depth + 1, { x, y, id: n.id })
                })
            }
            walk(tree?.branches || [], 0)
            layoutNodes.value = nodes
            edges.value = links
        }

        watch(
            () => branches?.currentBranchTree?.value,
            (tree) => layoutTree(tree),
            { immediate: true, deep: true },
        )

        async function selectNode(node) {
            const thread = ctx?.threads?.currentThread?.value
            if (!thread) return
            await branches.switchBranch(thread.id, node.id, {
                scrollContainer: document.getElementById('messages'),
            })
        }

        function zoomIn() { scale.value = Math.min(scale.value * 1.2, 3) }
        function zoomOut() { scale.value = Math.max(scale.value / 1.2, 0.4) }
        function resetView() { scale.value = 1; panX.value = 0; panY.value = 0 }

        function onWheel(e) {
            const delta = e.deltaY > 0 ? 0.9 : 1.1
            scale.value = Math.min(Math.max(scale.value * delta, 0.4), 3)
        }

        let panning = false
        let startX = 0
        let startY = 0

        function onPanStart(e) {
            panning = true
            startX = e.clientX - panX.value
            startY = e.clientY - panY.value
            document.addEventListener('mousemove', onPanMove)
            document.addEventListener('mouseup', onPanEnd)
        }
        function onPanMove(e) {
            if (!panning) return
            panX.value = e.clientX - startX
            panY.value = e.clientY - startY
        }
        function onPanEnd() {
            panning = false
            document.removeEventListener('mousemove', onPanMove)
            document.removeEventListener('mouseup', onPanEnd)
        }

        onMounted(() => {
            if (viewport.value) {
                width.value = viewport.value.clientWidth || 400
                height.value = viewport.value.clientHeight || 300
            }
        })
        onUnmounted(onPanEnd)

        return {
            width, height, viewBox, transform, layoutNodes, edges, currentBranchId,
            selectNode, zoomIn, zoomOut, resetView, onWheel, onPanStart, viewport, svg,
        }
    },
}

export default BranchTree
