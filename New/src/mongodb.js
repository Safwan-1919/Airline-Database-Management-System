const mongoose = require("mongoose")
mongoose.connect("mongodb://localhost:27017/LoginSignUp")
.then(()=>{
    console.log("mongodb connected");
})
.catch(()=>{
    console.log("failed to connect");
})

const loginSchema = mongoose.Schema({
    username:{
        type:String,
        required:true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password:{
        type:String,
        required:true
    }
})

const collection = mongoose.model("Collection1", loginSchema)

// module.exports = collection


// Customer Schema
const customerSchema = new mongoose.Schema({
    customerId: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    gender: { type: String, required: true },
    dob: { type: Date, required: true },
    aadharNumber: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pin: { type: String, required: true },
    country: { type: String, required: true },
    passportNumber: { type: String },
    passportExpiry: { type: Date }
});

const Customer = new mongoose.model('Customer', customerSchema);

const bookingSchema = new mongoose.Schema({
    customerId: { type: String, required: true },
    flightNumber: { type: String, required: true },
    departure: { type: String, required: true },
    arrival: { type: String, required: true },
    departureDate: { type: Date, required: true },
    arrivalDate: { type: Date, required: true },
    seatNumber: { type: String, required: true },
    class: { type: String, required: true }
});

const Booking = mongoose.model('Booking', bookingSchema);

// module.exports = {collection, Customer};

const historySchema = new mongoose.Schema({
    activity: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const History = mongoose.model('History', historySchema);

module.exports = { collection, Customer, Booking, History};