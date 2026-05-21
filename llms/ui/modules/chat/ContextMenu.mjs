import { ref, computed, onMounted, onUnmounted } from 'vue'

export const MessageContextMenu = {
    template: `
        <div v-if="visible"
            class="fixed z-[100] min-w-[12rem] py-1 rounded-md shadow-lg border text-sm"
            :class="[$styles.messageAssistant, $styles.chromeBorder]"
            :style="{ left: x + 'px', top: y + 'px' }"
            @click.stop>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="createBranch('copy')">Branch here (copy)</button>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="createBranch('reference')">Branch here (link)</button>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80 flex justify-between items-center"
                @click.stop="showSwitch = !showSwitch">
                Switch to branch…
                <span class="opacity-50 text-xs">{{ showSwitch ? '▾' : '▸' }}</span>
            </button>
            <div v-if="showSwitch" class="border-t max-h-40 overflow-y-auto" :class="$styles.chromeBorder">
                <button v-for="b in branchOptions" :key="b.id" type="button"
                    class="w-full text-left px-4 py-1 hover:opacity-80 text-xs truncate"
                    :style="{ paddingLeft: (16 + b.depth * 10) + 'px' }"
                    :disabled="b.id === currentBranchId"
                    @click="switchTo(b.id)">
                    {{ b.name }}
                </button>
            </div>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="openCompare">Compare with another branch</button>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="openDiffParent">Compare with parent</button>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="rewind">Rewind to branch start</button>
        </div>
    `,
    emits: ['close'],
    setup(props, { emit, expose }) {
        const visible = ref(false)
        const x = ref(0)
        const y = ref(0)
        const activeMessage = ref(null)
        const showSwitch = ref(false)
        const branches = globalThis.$branches
        const ctx = globalThis.$ctx

        const currentBranchId = computed(() => branches?.currentBranchId?.value)
        const branchOptions = computed(() =>
            branches.flattenBranchTree(branches?.currentBranchTree?.value),
        )

        function open(event, message) {
            x.value = event.clientX
            y.value = event.clientY
            visible.value = true
            showSwitch.value = false
            activeMessage.value = message
        }

        expose({ open })

        function close() {
            visible.value = false
            showSwitch.value = false
            emit('close')
        }

        async function createBranch(copyMode) {
            const thread = ctx?.threads?.currentThread?.value
            const msg = activeMessage.value
            if (!thread || (!msg?.id && !msg?.timestamp)) return close()
            const name = `branch-${Date.now()}`
            const payload = { threadId: thread.id, name, copyMode }
            if (msg.id != null) payload.messageId = msg.id
            else payload.parentMessageId = msg.timestamp
            await branches.createBranch(payload)
            close()
        }

        async function switchTo(branchId) {
            const thread = ctx?.threads?.currentThread?.value
            if (!thread) return close()
            await branches.switchBranch(thread.id, branchId)
            close()
        }

        function findBranchNode(nodes, id) {
            for (const n of nodes || []) {
                if (n.id === id) return n
                const child = findBranchNode(n.children, id)
                if (child) return child
            }
            return null
        }

        function openCompare() {
            branches.openBranchCompare()
            close()
        }

        async function openDiffParent() {
            const tree = branches?.currentBranchTree?.value
            const currentId = branches?.currentBranchId?.value
            const currentNode = findBranchNode(tree?.branches, currentId)
            const parentId = currentNode?.parentBranchId
            if (parentId && currentId && parentId !== currentId) {
                await branches.getBranchDiff(parentId, currentId)
                ctx.openModal('DiffViewer')
            } else {
                ctx.toast('No parent branch to compare')
            }
            close()
        }

        function rewind() {
            const container = document.getElementById('messages')
            branches?.rewindToBranchRoot?.(container)
            close()
        }

        const onDocClick = () => close()
        onMounted(() => document.addEventListener('click', onDocClick))
        onUnmounted(() => document.removeEventListener('click', onDocClick))

        return {
            visible,
            x,
            y,
            showSwitch,
            branchOptions,
            currentBranchId,
            createBranch,
            switchTo,
            openCompare,
            openDiffParent,
            rewind,
            open,
            close,
        }
    },
}

export default MessageContextMenu
