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
    props: {
        message: { type: Object, default: null },
    },
    emits: ['close'],
    setup(props, { emit }) {
        const visible = ref(false)
        const x = ref(0)
        const y = ref(0)
        const compareBranchId = ref(null)
        const branches = globalThis.$branches
        const ctx = globalThis.$ctx

        function open(event, message, branchId = null) {
            x.value = event.clientX
            y.value = event.clientY
            visible.value = true
            compareBranchId.value = branchId
            Object.assign(props, { message })
        }

        function close() {
            visible.value = false
            emit('close')
        }

        async function createBranch(copyMode) {
            const thread = ctx?.threads?.currentThread?.value
            const msg = props.message
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
            const thread = ctx?.threads?.currentThread?.value
            const bid = compareBranchId.value || branches?.currentBranchId?.value
            const other = branches?.currentBranchId?.value
            if (bid && other && bid !== other) {
                await branches.getBranchDiff(bid, other)
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
