const express = require("express")
const app = express()
const path = require("path")
const hbs = require("hbs")
const { collection, Customer, Booking, History } = require("./mongodb");
// const Customer = require("./mongodb")
const templatePath = path.join(__dirname,"../templates")

const moment = require('moment'); 
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;



app.use(express.json())
app.set("view engine","hbs")
app.set("views", templatePath)
app.use(express.urlencoded({extended:false}))
app.use(express.static(path.join(__dirname, "../public")));

hbs.registerHelper("formatDate", function (date) {
    return moment(date).format("YYYY-MM-DD HH:mm:ss");
  });

const logActivity = async (activity) => {
    try {
        await new History({ activity }).save();
    } catch (error) {
        console.error("Error logging activity:", error);
    }
};


app.get("/login",(req,res)=>{
    res.render("login")
})

app.get("/signup",(req,res)=>{
    res.render("signup")
})

app.get("/", (req, res) => {
    res.render("home");
});

app.get("/dashboard", (req, res) => {
    res.render("dashboard");
});

app.get("/customer-details", (req, res) => {
    res.render("customer-details");
});

app.post("/signup", async (req, res) => {
    const data = {
        username: req.body.username,
        email: req.body.email,
        password: req.body.password
    };

    try {
        // Check if the email already exists
        const existingUser = await collection.findOne({ email: data.email });
        if (existingUser) {
            return res.render("home", { message: "Email already registered" });
        }

        // If the email does not exist, insert the new user
        await collection.insertMany(data);
        logActivity(`User signed up: ${req.body.username}`);
        res.render("home", { message: "Registered Successfully" });
    } catch (error) {
        console.error(error);
        res.render("home", { message: "An error occurred during registration" });
    }
});

app.post("/login",async (req,res)=>{
    try{
        const check = await collection.findOne({username:req.body.username})
        if(check.password === req.body.password){
            logActivity(`User logged in: ${req.body.username}`);
            res.render("dashboard", {message: "You are Logged In"});
        }
        else{
            res.render("login", {messagenot:"Incorrect Password"});
        }
    }
    catch{
        res.render("login", {messagenot:"Incorrect Details"});
    }
})

const generateCustomerId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

app.post("/customer-details", async (req, res) => {
    try {
        const customerId = generateCustomerId();
        const customer = new Customer({
            customerId,
            ...req.body
        });
        await customer.save();
        await logActivity(`Customer details saved for customer ID ${customerId}`);

        res.render("customer-details", { 
            message: "Details saved successfully!",
            customerId 
        });
    } catch (err) {
        console.error("Error saving customer details:", err.message); // Log error message
        res.status(400).send("Error saving customer details");
    }
});

const countries = ["USA", "Canada", "India", "UK", "Australia", "Germany", "France"];

app.get('/booking', (req, res) => {
    res.render('booking', { countries });
});



// const generateBookingId = () => {
//     return Math.floor(100000 + Math.random() * 900000).toString();
// };

app.post("/fetch-customer", async (req, res) => {
    const { identifier } = req.body;
    let customer;
    if (identifier.length === 6) {
        customer = await Customer.findOne({ customerId: identifier });
    } else if (identifier.length === 14) {
        customer = await Customer.findOne({ aadharNumber: identifier });
    }
    
    if (!customer) {
        return res.status(404).send("Customer not found");
    }

    res.render("booking", { 
        customerId: customer.customerId,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        countries
    });
});


const flights = [
    { flightNumber: 'UA123', from: 'USA', to: 'Canada', departure: '10:00 AM', arrival: '02:00 PM', date: '2024-08-15', seatsAvailable: 100 },
    { flightNumber: 'LH456', from: 'India', to: 'USA', departure: '12:00 PM', arrival: '04:00 PM', date: '2024-08-16', seatsAvailable: 50 },
    { flightNumber: 'AA789', from: 'Canada', to: 'USA', departure: '09:00 AM', arrival: '01:00 PM', date: '2024-08-17', seatsAvailable: 75 }
];

app.get("/available-flights", (req, res) => {
    const { from, to } = req.query;
    const availableFlights = flights.filter(flight => flight.from === from && flight.to === to && flight.seatsAvailable > 0);
    if (availableFlights.length === 0) {
        return res.status(404).send({ message: "No flights available or seats are taken." });
    }
    res.json(availableFlights);
});

const flightSeats = {
    'UA123': 100,
    'LH456': 50,
    'AA789': 75
};

app.post("/booking", async (req, res) => {
    const { customerId, flightNumber, departure, arrival, departureDate, seatNumber, class: travelClass } = req.body;
    
    try {
        // Check if the seat number is already taken
        const existingBooking = await Booking.findOne({ flightNumber, seatNumber });
        if (existingBooking) {
            return res.status(400).json({ message: `Seat number ${seatNumber} is not available.` });
        }
        
        // Check seat availability for the flight
        if (flightSeats[flightNumber] <= 0) {
            return res.status(400).json({ message: `No seats available for flight ${flightNumber}.` });
        }

        // Calculate arrivalDate based on departureDate
        // Assuming a fixed duration for simplicity, e.g., 4 hours
        const flightDurationInHours = 4;
        const departureMoment = moment(departureDate);
        const arrivalMoment = departureMoment.add(flightDurationInHours, 'hours');
        const calculatedArrivalDate = arrivalMoment.format('YYYY-MM-DD');

        // Save booking
        const booking = new Booking({
            customerId,
            flightNumber,
            departure,
            arrival,
            departureDate,
            arrivalDate: calculatedArrivalDate, // Use calculated arrival date
            seatNumber,
            class: travelClass
        });
        await booking.save();
        
        // Decrement seat count
        flightSeats[flightNumber]--;
        await logActivity(`Booking made for customer ${customerId} on flight ${flightNumber}`);


        res.status(200).json({ message: `Booking successful! Booking ID: ${booking._id}` });
    } catch (error) {
        console.error("Error processing booking:", error.message); // Log the error
        res.status(500).json({ message: 'An error occurred while booking your flight.' });
    }
});

app.get("/cancellation", (req, res) => {
    res.render("cancellation");
});


app.post("/cancel-booking", async (req, res) => {
    const { bookingNumber } = req.body;
    console.log('Received booking number:', bookingNumber);
    
    try {
        if (!bookingNumber) {
            return res.status(400).json({ message: 'Please provide a booking number.' });
        }
        
        // Validate the booking number format
        if (!mongoose.Types.ObjectId.isValid(bookingNumber)) {
            return res.status(400).json({ message: 'Invalid booking number format.' });
        }

        // Check if the booking number is valid
        const booking = await Booking.findOne({ _id: new mongoose.Types.ObjectId(bookingNumber) });
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        // Remove the booking from the database
        const result = await Booking.deleteOne({ _id: new mongoose.Types.ObjectId(bookingNumber) });

        if (result.deletedCount === 1) {
            await logActivity(`Booking with ID ${bookingNumber} canceled`);
            res.json({ message: 'Booking canceled successfully.' });
        } else {
            res.status(404).json({ message: 'Booking not found.' });
        }
    } catch (error) {
        console.error('Error canceling booking:', error);
        res.status(500).json({ message: 'An error occurred while canceling the booking.' });
    }
});

// Fetch bookings by customer ID
app.get("/customer-bookings", async (req, res) => {
    const { customerId } = req.query;
    try {
        const bookings = await Booking.find({ customerId });
        if (bookings.length > 0) {
            res.json(bookings);
        } else {
            res.status(404).json({ message: 'No bookings found for this customer.' });
        }
    } catch (error) {
        console.error('Error fetching customer bookings:', error);
        res.status(500).json({ message: 'An error occurred while fetching customer bookings.' });
    }
});

app.get("/history", async (req, res) => {
    try {
      const activities = await History.find().sort({ timestamp: -1 });
      res.render("history", { activities });
    } catch (error) {
      console.error("Error fetching history:", error);
      res.status(500).send("An error occurred while fetching history.");
    }
  });

app.get('/logout', async (req, res) => {
  try {
    await logActivity('User logged out');
    // Perform any other logout actions like clearing session, etc.
    res.redirect('/');
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).send('Internal Server Error');
  }
});



app.listen(3000, ()=>{
    console.log("Port Connected!")
})