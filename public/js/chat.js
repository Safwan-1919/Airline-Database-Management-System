document.addEventListener('DOMContentLoaded', () => {
    const chatLauncher = document.getElementById('chat-launcher');
    const chatWidget = document.getElementById('chat-widget');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatBody = document.getElementById('chat-body');

    let chatInitialized = false;

    // Ensure launcher is visible on page load and centered
    chatLauncher.style.display = 'flex';

    function initializeChat() {
        if (chatInitialized) return;
        appendMessage("Hello! How can I help you today? You can ask me to book or cancel a flight.", 'agent');
        chatInitialized = true;
    }

    // --- Event Listeners ---
    chatLauncher.addEventListener('click', () => {
        chatWidget.style.display = 'flex';
        chatLauncher.style.display = 'none';
        initializeChat();
    });

    closeChatBtn.addEventListener('click', () => {
        chatWidget.style.display = 'none';
        chatLauncher.style.display = 'flex'; // Corrected from 'block'
    });

    chatSendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // --- Functions ---
    async function sendMessage() {
        const message = chatInput.value.trim();
        if (!message) return;

        appendMessage(message, 'customer');
        chatInput.value = '';
        
        // Add a temporary "thinking" message
        const thinkingMsg = appendMessage("Thinking...", 'agent');

        try {
            const response = await fetch('/api/chatbot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message }),
            });

            // Remove "thinking" message
            thinkingMsg.remove();

            const data = await response.json();
            appendMessage(data.reply, 'agent');

        } catch (error) {
            thinkingMsg.remove();
            appendMessage('Sorry, I am having trouble connecting.', 'agent');
        }
    }

    function appendMessage(message, type) {
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${type}`;
        messageElement.textContent = message;
        chatBody.appendChild(messageElement);
        chatBody.scrollTop = chatBody.scrollHeight;
        return messageElement;
    }
});
