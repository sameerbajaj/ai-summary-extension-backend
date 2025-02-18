import express from 'express';
import { MongoClient } from 'mongodb';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();

const app = express();
app.use(cors({
  origin: ['chrome-extension://jfbnkillpllpdeepbbllfcknebhcjjp'],
  methods: ['POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://sameerbajaj24:<db_password>@cluster0.gtyn8.mongodb.net/?retryWrites=true&w=majority';
const dbName = 'ai_summary_extension';

// Gemini API setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let mongoClient: MongoClient | null = null;

async function connectToMongo() {
  try {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

// Middleware to verify Google OAuth token
async function verifyGoogleToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(process.env.GOOGLE_CLIENT_ID!);
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error('Invalid token payload');
    }
    req.body.userId = payload.sub; // Google user ID
    req.body.email = payload.email;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// API endpoint to generate summary
app.post('/api/generate-summary', verifyGoogleToken, async (req, res) => {
  try {
    const { text, userId, email } = req.body;

    // Call Gemini API
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY!
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Please provide a concise summary of the following text: ${text}`
          }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error('Gemini API error');
    }

    const data = await response.json();
    
    // Store summary in MongoDB
    if (mongoClient) {
      const db = mongoClient.db(dbName);
      await db.collection('summaries').insertOne({
        userId,
        email,
        text,
        summary: data.candidates[0].content.parts[0].text,
        timestamp: new Date()
      });
    }

    res.json({ summary: data.candidates[0].content.parts[0].text });
  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await connectToMongo();
  console.log(`Server running on port ${PORT}`);
}); 