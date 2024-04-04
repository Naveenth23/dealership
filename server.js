const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());
const PORT = process.env.PORT || 8080;
const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'ecommerce';
const JWT_SECRET = 'your_secret_key';


// Middleware for JWT authentication
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = decoded;
    next();
  });
};

// Connect to MongoDB
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then(client => {
    const db = client.db(DB_NAME);
    const usersCollection = db.collection('users');
    const dealershipsCollection = db.collection('dealerships');
    const carsCollection = db.collection('cars');
    const dealsCollection = db.collection('deals');
    const blacklistCollection = db.collection('jwtBlacklist');

    app.get('/',(req,res)=>{
      res.json({status:'success',message:'Welcome to the E-commerce API'}); 
    });
    // Endpoint to register a new user
    app.post('/register', async (req, res) => {
      try {
        const { type } = req.body;
        if (type === 'user') {
          const { user_email, user_id, user_location, user_info, password, vehicle_info } = req.body;
          const hashedPassword = await bcrypt.hash(password, 10);
          await usersCollection.insertOne({ user_email, user_id, user_location, user_info, password: hashedPassword, vehicle_info });
        } else if (type === 'dealer') {
          const { dealership_name,dealership_email, dealership_id, dealership_location, dealership_info, password, cars,deals,sold_vehicles } = req.body;
          const hashedPassword = await bcrypt.hash(password, 10);
          await dealershipsCollection.insertOne({ dealership_name,dealership_email,dealership_id, dealership_location, dealership_info, password: hashedPassword, cars,deals,sold_vehicles });
        } else {
          return res.status(400).json({ message: 'Invalid user type' });
        }
        res.status(201).json({ message: 'User registered successfully' });
      } catch (error) {
        console.log(error.message);
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

     // Endpoint to register a new car
     app.post('/cars', async (req, res) => {
      try {
        const { car_id, type, name, model, car_info } = req.body;
        await carsCollection.insertOne({ car_id, type, name, model, car_info });
        res.status(201).json({ message: 'Car created successfully' });
      } catch (error) {
        console.log(error.message)
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // Endpoint to create a new deal
    app.post('/deals', async (req, res) => {
      try {
        const { deal_id, car_id, deal_info } = req.body;
        await dealsCollection.insertOne({ deal_id, car_id, deal_info });
        res.status(201).json({ message: 'Deal created successfully' });
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    app.get('/my-vehicles', authenticateJWT, async (req, res) => {
      // const vehicles = await dealsCollection.find({ userId: ObjectId(userId) }).toArray();
      const userId = req.user.user._id;
      const cars = await carsCollection.find({ userId:userId }).toArray();

      const carsWithDealerInfo = await Promise.all(
        cars.map(async (vehicle) => {
          const deal = await dealsCollection.findOne({ _id: vehicle.dealId });
          return { ...vehicle, dealerInfo: deal };
        })
      );
      
      return carsWithDealerInfo;

      // try {
      //   const userId = req.user.id; // Assuming userId is included in the JWT payload
      //   const userVehicles = await Vehicle.find({ userId }); // Fetch vehicles associated with the user
      //   res.json(userVehicles);
      // } catch (error) {
      //   console.error('Error fetching user vehicles:', error);
      //   res.status(500).json({ message: 'Internal Server Error' });
      // }
    });

    app.get('/vehicles', async (req, res) => {
      try {
        const cars = await db.collection('cars').find({}).toArray();
        res.json(cars);
      } catch (error) {
        console.error('Error fetching cars:', error);
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // Endpoint to view all vehicles dealership has sold along with owner info  
    app.get('/sold-vehicles', async (req, res) => {
      try {
        const soldVehicles = await dealsCollection.aggregate([
          {
            $match: { "deal_info.status": "sold" }
          },
          {
            $lookup: {
              from: "cars",
              localField: "car_id",
              foreignField: "car_id",
              as: "car"
            }
          },
          {
            $unwind: "$car"
          },
          {
            $lookup: {
              from: "users",
              localField: "deal_info.buyer",
              foreignField: "user_id",
              as: "owner"
            }
          },
          {
            $unwind: "$owner"
          },
          {
            $project: {
              _id: 0,
              deal_id: 1,
              car_id: 1,
              car: "$car",
              owner: "$owner"
            }
          }
        ]).toArray();
    
        res.json(soldVehicles);
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });
    // Endpoint to authenticate user and generate JWT
    app.post('/login', async (req, res) => {

      try {
        const { type, email, password } = req.body;
        if (type === 'user') {
         user = await usersCollection.findOne({ user_email:email });
        } else if (type === 'dealer') {
          user = await dealershipsCollection.findOne({ dealership_email:email });
          console.log(user);
        } else {
          return res.status(400).json({ message: 'Invalid user type' });
        }

        if (!user || !(await bcrypt.compare(password, user.password))) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ type, user }, JWT_SECRET);
        res.json({ token,status:"success",message: 'Login successful',role:type });
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // Endpoint to invalidate JWT (logout)
    app.post('/logout', authenticateJWT, async (req, res) => {
      try {
        await blacklistCollection.insertOne({ token: req.headers.authorization });
        res.json({ message: 'Logged out successfully' });
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // Endpoint to change password
    app.put('/password', authenticateJWT, async (req, res) => {
      try {
        const { newPassword } = req.body;
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const username = req.user.username;
        const type = req.user.type;
        if (type === 'user') {
          await usersCollection.updateOne({ username }, { $set: { password: hashedPassword } });
        } else if (type === 'dealership') {
          await dealershipsCollection.updateOne({ username }, { $set: { password: hashedPassword } });
        } else {
          return res.status(400).json({ message: 'Invalid user type' });
        }
        res.json({ message: 'Password updated successfully' });
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // Common REST endpoints for both user and dealership
    app.get('/profile', authenticateJWT, async (req, res) => {
      try {
        const username = req.user.username;
        const type = req.user.type;
        if (type === 'user') {
          const user = await usersCollection.findOne({ username });
          res.json(user);
        } else if (type === 'dealership') {
          const dealership = await dealershipsCollection.findOne({ username });
          res.json(dealership);
        } else {
          return res.status(400).json({ message: 'Invalid user type' });
        }
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(error => console.error('Error connecting to the database', error));