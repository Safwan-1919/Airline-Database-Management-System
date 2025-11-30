document.addEventListener('DOMContentLoaded', () => {
    const sessionListUl = document.getElementById('session-list-ul');
    const chatArea = document.querySelector('.chat-area');
    const socket = io();

    let currentSessionId = null;
    let currentCustomer = null;

    // --- Tab Switching Logic ---
    document.querySelectorAll('.tab-link').forEach(button => {
        button.addEventListener('click', () => {
            const tab = button.dataset.tab;
            document.querySelectorAll('.tab-link').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(tab).classList.add('active');
        });
    });

    // --- Socket Event Listeners ---
    socket.on('connect', () => { console.log('Agent connected to chat server.'); });

    socket.on('agent:newSession', (session) => {
        if (!document.querySelector(`li[data-session-id="${session._id}"]`)) {
            const li = document.createElement('li');
            li.textContent = `Chat with ${session.customerId.username || 'Customer'}`;
            li.dataset.sessionId = session._id;
            li.addEventListener('click', () => activateSession(session._id));
            sessionListUl.appendChild(li);
        }
    });

    socket.on('chat:message', ({ sender, message }) => {
        const chatPanel = document.querySelector('#chat-panel');
        if (currentSessionId && chatPanel && chatPanel.dataset.sessionId === currentSessionId) {
            const type = sender === AGENT_USER_ID ? 'agent' : 'customer';
            appendMessage(message, type);
        }
    });

    // --- Functions ---
    async function activateSession(sessionId) {
        if (currentSessionId) {
            const oldLi = document.querySelector(`li[data-session-id="${currentSessionId}"]`);
            if (oldLi) oldLi.classList.remove('active');
        }
        currentSessionId = sessionId;
        document.querySelector(`li[data-session-id="${sessionId}"]`).classList.add('active');

        socket.emit('agent:joinSession', sessionId);

        try {
            const custResponse = await fetch(`/api/customer-from-session/${sessionId}`);
            currentCustomer = await custResponse.json();
            
            setupChatPanel(sessionId);
            setupBookingPanel(currentCustomer);
            setupCancellationPanel(currentCustomer);
        } catch (error) {
            console.error("Failed to setup agent panels:", error);
            chatArea.innerHTML = '<h2>Error loading session. Please try again.</h2>';
        }
    }

    async function setupChatPanel(sessionId) {
        const chatPanel = document.getElementById('chat-panel');
        chatPanel.innerHTML = `
            <div class="chat-body" id="agent-chat-body"></div>
            <div class="chat-footer">
                <input type="text" id="agent-chat-input" placeholder="Type a message...">
                <button id="agent-chat-send-btn">Send</button>
            </div>
        `;
        chatPanel.dataset.sessionId = sessionId;

        document.getElementById('agent-chat-send-btn').addEventListener('click', sendAgentMessage);
        document.getElementById('agent-chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendAgentMessage();
        });

        const histResponse = await fetch(`/api/chat-history/${sessionId}`);
        const history = await histResponse.json();
        const chatBody = document.getElementById('agent-chat-body');
        chatBody.innerHTML = '';
        history.forEach(msg => {
            const type = msg.sender === AGENT_USER_ID ? 'agent' : 'customer';
            appendMessage(msg.message, type);
        });
    }
    
    function setupBookingPanel(customer) {
        const bookPanel = document.getElementById('book-panel');
        if(customer && customer.customerId) {
            bookPanel.innerHTML = `
                <h3>Booking for ${customer.firstName} ${customer.lastName}</h3>
                <p>Click the button below to open the booking page for this customer in a new tab.</p>
                <a href="/booking?customerId=${customer.customerId}" target="_blank" class="btn-action">Book New Flight</a>
            `;
        } else {
             bookPanel.innerHTML = `<p>Customer data not available.</p>`;
        }
    }
    
    async function setupCancellationPanel(customer) {
        const cancelPanel = document.getElementById('cancel-panel');
        if (!customer || !customer.customerId) {
            cancelPanel.innerHTML = '<p>Customer data not available.</p>';
            return;
        }

        try {
            const response = await fetch(`/api/bookings-for-customer/${customer.customerId}`);
            const bookings = await response.json();

            if (bookings.length === 0) {
                cancelPanel.innerHTML = '<h3>Cancel Bookings</h3><p>This customer has no active bookings.</p>';
                return;
            }

            let tableHTML = `
                <h3>Cancel Bookings for ${customer.firstName}</h3>
                <table>
                    <thead><tr><th>Flight</th><th>Seat</th><th>Date</th><th>Action</th></tr></thead>
                    <tbody>
            `;
            bookings.forEach(booking => {
                tableHTML += `
                    <tr>
                        <td>${booking.flightNumber}</td>
                        <td>${booking.seatNumber}</td>
                        <td>${new Date(booking.departureDate).toLocaleDateString()}</td>
                        <td><button class="btn-cancel" data-booking-id="${booking._id}">Cancel</button></td>
                    </tr>
                `;
            });
            tableHTML += '</tbody></table>';
            cancelPanel.innerHTML = tableHTML;

            cancelPanel.querySelectorAll('.btn-cancel').forEach(button => {
                button.addEventListener('click', async (e) => {
                    const bookingId = e.target.dataset.bookingId;
                    if (confirm('Are you sure you want to cancel this booking?')) {
                        await fetch('/cancel-booking', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bookingNumber: bookingId })
                        });
                        // Refresh the panel
                        setupCancellationPanel(customer); 
                    }
                });
            });

        } catch (error) {
            cancelPanel.innerHTML = '<p>Error loading bookings.</p>';
        }
    }

    function sendAgentMessage() {
        const input = document.getElementById('agent-chat-input');
        const message = input.value.trim();
        if (message && currentSessionId) {
            socket.emit('chat:message', { sessionId: currentSessionId, message: message });
            input.value = '';
        }
    }

    function appendMessage(message, type) {
        const chatBody = document.getElementById('agent-chat-body');
        if (chatBody) {
            const el = document.createElement('div');
            el.className = `chat-message ${type}`;
            el.textContent = message;
            chatBody.appendChild(el);
            chatBody.scrollTop = chatBody.scrollHeight;
        }
    }

    document.querySelectorAll('#session-list-ul li').forEach(li => {
        li.addEventListener('click', () => activateSession(li.dataset.sessionId));
    });
});
