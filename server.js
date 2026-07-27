/**
 * SERVEUR MISS DIGITAL RDC - INTÉGRATION GOOGLE SHEETS
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios'); // N'oublie pas de faire 'npm install axios'
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// TON URL GOOGLE SCRIPT
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyhVFoTrynnRHkExlBk1zAM6Nayy__wSm03UBwOBr2otPr04GDOzXWfvS2vjnXJFrAS/exec";

// 1. Sert tes fichiers web (HTML, CSS, JS) automatiquement
app.use(express.static(__dirname));

// 2. Route pour afficher ta page principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Route pour enregistrer un vote
app.post('/api/vote', async (req, res) => {
    try {
        // Envoi des données vers ton Google Sheet via le script
        const response = await axios.post(GOOGLE_SCRIPT_URL, req.body);
        res.json(response.data);
    } catch (error) {
        console.error("Erreur envoi Google Sheet:", error);
        res.status(500).json({ success: false, message: "Erreur de connexion à la base de données." });
    }
});

// 4. Route pour récupérer les votes actuels
app.get('/api/votes', async (req, res) => {
    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ success: false, message: "Impossible de récupérer les votes." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Serveur Miss Digital RDC actif sur le port ${PORT}`);
});
