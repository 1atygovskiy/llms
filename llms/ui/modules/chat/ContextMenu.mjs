import { ref, onMounted, onUnmounted } from 'vue'

export const MessageContextMenu = {
    template: `
        <div v-if="visible"
            class="fixed z-[100] min-w-[11rem] py-1 rounded-md shadow-lg border text-sm"
            :class="[$styles.messageAssistant, $styles.chromeBorder]"
            :style="{ left: x + 'px', top: y + 'px' }"
            @click.stop>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="createBranch('copy')">Branch here (copy)</button>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="createBranch('reference')">Branch here (link)</button>
            <button type="button" class="w-full text-left px-3 py-1.5 hover:opacity-80"
                @click="openDiff">Compare with current</button>
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
        const branches = globalThis.$branches
        const ctx = globalThis.$ctx

        function open(event, message) {
            x.value = event.clientX
            y.value = event.clientY
            visible.value = true
            activeMessage.value = message
        }

        expose({ open })

        function close() {
            visible.value = false
            emit('close')
        }

        async function createBranch(copyMode) {
            const thread = ctx?.threads?.currentThread?.value
            const msg = activeMessage.value
            if (!thread || !msg?.timestamp) return close()
            const name = `branch-${Date.now()}`
            await branches.createBranch({
                threadId: thread.id,
                parentMessageId: msg.timestamp,
                name,
                copyMode,
            })
            close()
        }

        async function openDiff() {
            const tree = branches?.currentBranchTree?.value
            const currentId = branches?.currentBranchId?.value
            const parentId = tree?.branches?.[0]?.parentBranchId
            if (parentId && currentId && parentId !== currentId) {
                await branches.getBranchDiff(parentId, currentId)
                ctx.openModal('DiffViewer')
            }
            close()
        }

        function rewind() {
            const container = document.getElementById('messages')
            branches.rewindToBranchRoot(container)
            close()
        }

        const onDocClick = () => close()
        onMounted(() => document.addEventListener('click', onDocClick))
        onUnmounted(() => document.removeEventListener('click', onDocClick))

        return { visible, x, y, createBranch, openDiff, rewind, open, close }
    },
}

export default MessageContextMenu
