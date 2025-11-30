const express = require("express");
const app = express();
const path = require("path");
const hbs = require("hbs");
const { collection, Customer, Booking, History, ChatSession, ChatMessage } = require("./mongodb");
const bcrypt = require('bcrypt');
const moment = require('moment');
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;
const http = require('http');
const socketio = require('socket.io');
const session = require("express-session");
const MongoStore = require("connect-mongo");
const fs = require('fs');
const fetch = require('node-fetch');

const server = http.createServer(app);
const io = socketio(server);

const templatePath = path.join(__dirname, "../templates");
const partialsPath = path.join(__dirname, "../templates/partials");

// --- Middleware Setup ---
app.use(express.json());
app.set("view engine", "hbs");
app.set("views", templatePath);
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "../public")));

const sessionMiddleware = session({
    secret: 'mysecret',
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: 'mongodb://localhost:27017/LoginSignUp' })
});
app.use(sessionMiddleware);
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- Handlebars Helpers ---
hbs.registerHelper("formatDate", (date) => moment(date).format("YYYY-MM-DD HH:mm:ss"));
hbs.registerHelper('eq', (a, b) => a === b);
hbs.registerHelper('isCheckinAvailable', (departureDate, status) => {
    if (status !== 'Booked') return false;
    const hoursUntilDeparture = moment(departureDate).diff(moment(), 'hours');
    return hoursUntilDeparture > 0 && hoursUntilDeparture <= 48;
});
hbs.registerHelper('JSONstringify', (obj) => JSON.stringify(obj));
hbs.registerPartials(partialsPath);

// --- Data & Utility Functions ---
let airportCache = null;
const getAirports = () => {
    if (airportCache) return airportCache;
    try {
        const filePath = path.join(__dirname, 'data', 'airports.json');
        const airportsData = fs.readFileSync(filePath, 'utf8');
        let airports = JSON.parse(airportsData);
        const validAirports = airports.filter(a => a && a.iata && a.name && a.type === 'airport' && a.status === 1);
        validAirports.sort((a, b) => a.name.localeCompare(b.name));
        airportCache = validAirports;
        return airportCache;
    } catch (error) {
        console.error("Error initializing airport data:", error);
        return [];
    }
};

const AVIATION_API_KEY = "24b89bb0814f08df136fe2ca385f2568";
const AVIATION_API_URL = `http://api.aviationstack.com/v1/flights?access_key=${AVIATION_API_KEY}`;

const fetchFlights = async (from, to) => {
    const url = `${AVIATION_API_URL}&dep_iata=${from}&arr_iata=${to}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!data || !data.data) return [];
        return data.data.map(f => ({
            flightNumber: f.flight.iata,
            from: f.departure.airport,
            to: f.arrival.airport,
            departure: f.departure.scheduled,
            arrival: f.arrival.scheduled,
            date: f.flight_date,
        }));
    } catch (error) {
        console.error("Error fetching flights from AviationStack:", error);
        return [];
    }
};

const generateCustomerId = () => Math.floor(100000 + Math.random() * 900000).toString();

const logActivity = async (activity, userId = null) => {
    try {
        await new History({ activity, userId }).save();
        io.emit('dataChanged'); // This triggers the dashboard refresh
    } catch (error) {
        console.error("Error logging activity:", error);
    }
};

const getDashboardData = async (userId) => {
    try {
        if (!userId) {
            return {
                flightsBooked: await Booking.countDocuments(),
                upcomingFlights: await Booking.countDocuments({ departureDate: { $gte: new Date() } }),
                totalSpent: await Booking.countDocuments() * 200,
                cancellations: await History.countDocuments({ activity: /canceled/ }),
                activeUsers: await collection.countDocuments(),
                revenue: await Booking.countDocuments() * 200,
                recentBookings: await Booking.find().sort({ departureDate: -1 }).limit(5)
            };
        }
        const user = await collection.findById(userId);
        if (!user) return null;
        const userEmail = user.email;

        // Find the customer associated with this email
        const customer = await Customer.findOne({ email: userEmail });
        
        if (!customer) {
            return { flightsBooked: 0, upcomingFlights: 0, totalSpent: 0, cancellations: 0, activeUsers: await collection.countDocuments(), revenue: 0, recentBookings: [] };
        }
        const flightsBooked = await Booking.countDocuments({ customerId: customer.customerId });
        const upcomingFlights = await Booking.countDocuments({ customerId: customer.customerId, departureDate: { $gte: new Date() } });
        const totalSpent = flightsBooked * 200;
        const cancellations = await History.countDocuments({ userId: userId });
        const recentBookings = await Booking.find({ customerId: customer.customerId }).sort({ departureDate: -1 }).limit(5);
        const flightsByClass = await Booking.aggregate([
            { $match: { customerId: customer.customerId } },
            { $group: { _id: "$class", count: { $sum: 1 } } },
            { $sort: { "_id": 1 } }
        ]);
        const classLabels = flightsByClass.map(item => item._id);
        const classData = flightsByClass.map(item => item.count);
        return { flightsBooked, upcomingFlights, totalSpent, cancellations, activeUsers: await collection.countDocuments(), revenue: totalSpent, recentBookings, classLabels, classData };
    } catch (error) {
        console.error("Error in getDashboardData:", error);
        throw error;
    }
};

// --- Socket.io Logic ---
io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return;

    getDashboardData(userId).then(data => {
        if(data) socket.emit('dashboardData', data);
    });

    collection.findById(userId).then(user => {
        if (user && user.role === 'agent') socket.join('agents');
    });

    socket.on('customer:startChat', async () => {
        try {
            let sess = await ChatSession.findOneAndUpdate({ customerId: userId, status: { $in: ['waiting', 'active'] } }, { status: 'waiting' }, { new: true, upsert: true }).populate('customerId');
            socket.join(sess._id.toString());
            socket.emit('chat:sessionCreated', sess._id);
            io.to('agents').emit('agent:newSession', sess);
        } catch (error) { console.error('Error starting chat:', error); }
    });
    socket.on('agent:joinSession', async (sessionId) => {
        const agentId = socket.request.session.userId;
        socket.join(sessionId);
        await ChatSession.findByIdAndUpdate(sessionId, { status: 'active', agentId });
        io.to(sessionId).emit('agent:joined', { agentId });
    });
    socket.on('chat:message', async ({ sessionId, message }) => {
        try {
            const msg = new ChatMessage({ chatSessionId: sessionId, sender: userId, message });
            await msg.save();
            io.to(sessionId).emit('chat:message', { sender: userId, message: msg.message });
        } catch (error) { console.error('Error saving message:', error); }
    });
});

// --- Middleware ---
const requireLogin = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAgent = async (req, res, next) => {
    try {
        const user = await collection.findById(req.session.userId);
        (user && user.role === 'agent') ? next() : res.status(403).send("Access Denied");
    } catch { res.status(500).send("An error occurred."); }
};

// --- Page & Action Routes ---
app.get("/", (req, res) => res.render("home"));
app.get("/login", (req, res) => res.render("login"));
app.get("/signup", (req, res) => res.render("signup"));
app.get('/logout', (req, res) => {
    const userId = req.session.userId;
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/dashboard');
        }
        if (userId) {
            logActivity('User logged out', userId);
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});
app.get("/dashboard", requireLogin, async (req, res) => {
    const data = await getDashboardData(req.session.userId);
    res.render("dashboard", { ...data, activePage: 'dashboard', username: req.session.username });
});
app.get("/history", requireLogin, async (req, res) => {
    const activities = await History.find({ userId: req.session.userId }).sort({ timestamp: -1 });
    res.render("history", { activities, activePage: 'history', username: req.session.username });
});
app.get("/cancellation", requireLogin, (req, res) => res.render("cancellation", { activePage: 'cancellation' }));
app.get("/customer-details", requireLogin, (req, res) => res.render("customer-details", { activePage: 'user' }));
app.get("/profile", requireLogin, async (req, res) => {
    const user = await collection.findById(req.session.userId);
    const customer = await Customer.findOne({ email: user.email });
    const bookings = customer ? await Booking.find({ customerId: customer.customerId }).sort({ departureDate: -1 }) : [];
    res.render("profile", { customer, bookings, activePage: 'profile', username: req.session.username });
});
app.get("/agent-dashboard", requireLogin, requireAgent, async (req, res) => {
    const sessions = await ChatSession.find({ status: { $in: ['waiting', 'active'] } }).populate('customerId', 'username').sort({ createdAt: 1 });
    res.render("agent-dashboard", { sessions, activePage: 'agent-dashboard', username: req.session.username, userId: req.session.userId });
});
app.get("/booking", requireLogin, async (req, res) => {
    const airports = getAirports();
    const { customerId } = req.query;
    if (customerId) {
        const customer = await Customer.findOne({ customerId });
        if (customer) return res.render("booking", { pageTitle: "Booking for Customer", activePage: 'booking', airports, customerId: customer.customerId, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone });
    }
    res.render("booking", { pageTitle: "Booking", activePage: 'booking', airports });
});
app.get("/boarding-pass/:bookingId", requireLogin, async (req, res) => {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking || booking.status !== 'Checked-In') return res.status(404).send("Boarding pass not available.");
    const customer = await Customer.findOne({ customerId: booking.customerId });
    res.render("boarding-pass", { booking, customer, username: req.session.username });
});
app.get("/contact", (req, res) => res.render("contact"));
app.post("/login", async (req, res) => {
    try {
        const check = await collection.findOne({ username: req.body.username.trim() });
        if (check && await bcrypt.compare(req.body.password.trim(), check.password)) {
            req.session.userId = check._id;
            req.session.username = check.username;
            await logActivity('User logged in', check._id);
            res.redirect("/dashboard");
        } else {
            res.render("login", { messagenot: "Incorrect username or password" });
        }
    } catch { res.render("login", { messagenot: "An error occurred" }); }
});
app.post("/signup", async (req, res) => {
    try {
        if (await collection.findOne({ email: req.body.email })) return res.render("home", { message: "Email already registered" });
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await collection.create({ username: req.body.username, email: req.body.email, password: hashedPassword });
        res.render("home", { message: "Registered Successfully" });
    } catch { res.render("home", { message: "An error occurred" }); }
});
app.post("/fetch-customer", requireLogin, async (req, res) => {
    const { identifier } = req.body;
    let customer = (identifier.length === 6) ? await Customer.findOne({ customerId: identifier }) : await Customer.findOne({ aadharNumber: identifier });
    if (!customer) return res.status(404).send("Customer not found");
    res.render("booking", { pageTitle: "Booking", activePage: 'booking', airports: getAirports(), customerId: customer.customerId, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone });
});
app.post("/booking", requireLogin, async (req, res) => {
    try {
        if (await Booking.findOne({ flightNumber: req.body.flightNumber, seatNumber: req.body.seatNumber })) return res.status(400).json({ message: `Seat number ${req.body.seatNumber} is not available.` });
        const booking = new Booking(req.body);
        await booking.save();
        await logActivity(`New booking created: ${booking._id}`, req.session.userId);
        res.status(200).json({ message: `Booking successful! Booking ID: ${booking._id}` });
    } catch(e) { res.status(500).json({ message: 'An error occurred while booking.' }); }
});
app.post("/cancel-booking", requireLogin, async (req, res) => {
    try {
        await Booking.deleteOne({ _id: req.body.bookingNumber });
        await logActivity(`Booking canceled: ${req.body.bookingNumber}`, req.session.userId);
        res.json({ message: 'Booking canceled successfully.' });
    } catch { res.status(500).json({ message: 'Error canceling booking.'}); }
});
app.post("/check-in/:bookingId", requireLogin, async (req, res) => {
    await Booking.findByIdAndUpdate(req.params.bookingId, { status: 'Checked-In' });
    await logActivity(`Checked in for booking: ${req.params.bookingId}`, req.session.userId);
    res.redirect(`/boarding-pass/${req.params.bookingId}`);
});
app.post("/customer-details", requireLogin, async (req, res) => {
    const customer = new Customer({ customerId: generateCustomerId(), ...req.body });
    await customer.save();
    await logActivity(`New customer created: ${customer.firstName} ${customer.lastName}`, req.session.userId);
    res.render("customer-details", { message: "Details saved successfully!", customerId: customer.customerId });
});
app.post("/profile", requireLogin, async (req, res) => {
    await Customer.updateOne({ email: req.body.email }, { $set: req.body });
    res.redirect("/profile");
});
app.post("/contact", (req, res) => res.render("contact", { message: "Your message has been sent successfully!" }));

// --- API Routes ---
app.get("/dashboard-data", requireLogin, async (req, res) => {
    const data = await getDashboardData(req.session.userId);
    res.json(data);
});
app.get("/available-flights", requireLogin, async (req, res) => {
    const { from, to } = req.query;
    const availableFlights = await fetchFlights(from, to);
    if (!availableFlights.length) return res.status(404).json({ message: "No flights available." });
    res.json(availableFlights);
});
app.get('/api/flights/:flightNumber/seats', requireLogin, async (req, res) => {
    const bookings = await Booking.find({ flightNumber: req.params.flightNumber });
    res.json(bookings.map(b => b.seatNumber));
});
app.get("/api/customer-from-session/:sessionId", requireLogin, requireAgent, async (req, res) => {
    const chatSession = await ChatSession.findById(req.params.sessionId).populate('customerId');
    res.json(chatSession.customerId);
});
app.get("/api/chat-history/:sessionId", requireLogin, requireAgent, async (req, res) => {
    const messages = await ChatMessage.find({ chatSessionId: req.params.sessionId }).sort({ timestamp: 'asc' });
    res.json(messages);
});
app.get("/api/bookings-for-customer/:customerId", requireLogin, requireAgent, async (req, res) => {
    const customer = await Customer.findOne({ customerId: req.params.customerId });
    const bookings = await Booking.find({ customerId: customer.customerId }).sort({ departureDate: -1 });
    res.json(bookings);
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

// AI Setup
const genAI = new GoogleGenerativeAI("AIzaSyDBP2H5tSq7qb-SxMTogqUpz9ibxpWbEaA");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const tools = [
    {
      functionDeclarations: [
        {
          name: "book_flight",
          description: "Books a flight for a user.",
          parameters: {
            type: "OBJECT",
            properties: {
              customerId: { type: "STRING", description: "The unique ID of the customer." },
              flightNumber: { type: "STRING", description: "The flight number, e.g., 'BA2490'." },
              date: { type: "STRING", description: "The date of the flight in YYYY-MM-DD format." },
              seatNumber: { type: "STRING", description: "The seat number, e.g., '14A'." },
              class: { type: "STRING", description: "The travel class, e.g., 'Economy'." },
            },
            required: ["customerId", "flightNumber", "date", "seatNumber", "class"],
          },
        },
        {
          name: "cancel_flight",
          description: "Cancels a flight booking for a user.",
          parameters: {
            type: "OBJECT",
            properties: {
              bookingId: { type: "STRING", description: "The unique ID of the booking to cancel." },
            },
            required: ["bookingId"],
          },
        },
      ],
    },
];

async function book_flight(args) {
    try {
        const { customerId, flightNumber, date, seatNumber, class: travelClass } = args;
        // Simplified booking logic, assuming departure/arrival can be inferred or are not needed for this step
        const booking = new Booking({ customerId, flightNumber, departure: "N/A", arrival: "N/A", departureDate: date, arrivalDate: date, seatNumber, class: travelClass });
        await booking.save();
        return { success: true, bookingId: booking._id.toString() };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function cancel_flight(args) {
    try {
        const { bookingId } = args;
        const result = await Booking.deleteOne({ _id: bookingId });
        if (result.deletedCount > 0) {
            return { success: true, message: "Booking canceled successfully." };
        }
        return { success: false, error: "Booking not found." };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

app.post("/api/chatbot", requireLogin, async (req, res) => {
    const { message } = req.body;
    
    try {
        const chat = model.startChat({ tools: tools });
        const result = await chat.sendMessage(message);
        const call = result.response.functionCalls()?.[0];

        if (call) {
            const apiResponse = await global[call.name](call.args);
            const result2 = await chat.sendMessage([
                {
                    functionResponse: {
                        name: call.name,
                        response: apiResponse,
                    },
                },
            ]);
            const finalResponse = result2.response.text();
            res.json({ reply: finalResponse });
        } else {
            res.json({ reply: result.response.text() });
        }
    } catch (error) {
        console.error("AI Chatbot Error:", error);
        res.status(500).json({ reply: "Sorry, I encountered an error." });
    }
});

app.get("/weather", async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "Latitude and longitude are required" });
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    try {
        const response = await fetch(url);
        const weatherData = await response.json();
        res.json(weatherData);
    } catch (error) { res.status(500).json({ error: "Failed to fetch weather data" }); }
});

app.get("/debug-customer-emails", requireLogin, async (req, res) => {
    try {
        const loggedInUser = await collection.findById(req.session.userId);
        const allCustomers = await Customer.find({}, 'firstName lastName email customerId');
        
        res.json({
            loggedInUserEmail: loggedInUser ? loggedInUser.email : 'Not logged in',
            allCustomerProfiles: allCustomers
        });
    } catch (error) {
        console.error("Error in /debug-customer-emails:", error);
        res.status(500).json({ error: "Failed to fetch debug info" });
    }
});

// --- Server Listen ---
server.listen(3000, () => {
    console.log("Port Connected!");
});
