import express from 'express';
import { MongoClient } from 'mongodb';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();

const app = express();
app.use(cors({
  origin: /^chrome-extension:\/\/.*$/,
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// MongoDB connection
const mongoUri = process.env.MONGODB_URI;
const dbName = 'ai_summary_extension';

// Gemini API setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize MongoDB connection
let mongoClient: MongoClient | null = null;

async function getMongoClient() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri!);
    await mongoClient.connect();
  }
  return mongoClient;
}

// Middleware to verify Google OAuth token
async function verifyGoogleToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  try {
    const token = authHeader.split(' ')[1];
    
    // Validate access token
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    if (!response.ok) {
      throw new Error('Invalid token');
    }
    
    const data = await response.json();
    if (!data.email) {
      throw new Error('Token does not contain email');
    }
    
    req.body.userId = data.sub;
    req.body.email = data.email;
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

    // Trim and limit text length to avoid timeouts
    const maxLength = 4000;
    const trimmedText = text.length > maxLength 
      ? text.substring(0, maxLength) + '...'
      : text;

    // Call Gemini API with optimized settings
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY!
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Provide a very concise summary of this text (max 250 words): ${trimmedText}`
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
          topP: 0.8,
          topK: 40
        }
      })
    });

    if (!response.ok) {
      throw new Error('Gemini API error');
    }

    const data = await response.json();
    const summary = data.candidates[0].content.parts[0].text;

    // Store summary in MongoDB asynchronously
    getMongoClient().then(client => {
      const db = client.db(dbName);
      db.collection('summaries').insertOne({
        userId,
        email,
        text: trimmedText,
        summary,
        timestamp: new Date()
      }).catch(err => console.error('MongoDB error:', err));
    });

    // Send response immediately without waiting for MongoDB
    res.json({ summary });
  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Only start the server if we're not in a Vercel environment
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app; 