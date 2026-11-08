'use strict';
/**
 * Dhismaha Maamul — backend (zero-dependency Node.js)
 * Xogta: data/db.json, ama MongoDB haddii MONGODB_URI la dejiyo.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const MONGO_URI = process.env.MONGODB_URI;
const MONGO_DB = process.env.MONGODB_DB || 'dhismaha';
const SESSION_DAYS = 7;
const MAX_BODY = 1024 * 1024;

let mongoCol = null;
let db = null;

const emptyDb = () => ({
  users: [], sessions: {}, customers: [], items: [],
  invoices: [], payments: [], expenses: [], counters: { invoice: 0 }
});

function loadFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(emptyDb(), null, 2));
  return { ...emptyDb(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
}

async function initStorage() {
  if (!MONGO_URI) return loadFile();
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  mongoCol = client.db(MONGO_DB).collection('appdata');
  const doc = await mongoCol.findOne({ _id: 'main' });
  if (!doc) return emptyDb();
  delete doc._id;
