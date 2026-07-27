const express = require('express');
const fs = require('fs');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

// Fonction pour lire les données
const readData = () => {
    return JSON.parse(fs.readFileSync('data.json', 'utf8'));
};

// Fonction pour sauvegarder les données
const saveData = (data) => {
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
};

app.post('/api/vote', (req, res) => {
    const { candidateId } = req.body; // Exemple: "02"
    
    // Récupérer l'IP réelle du visiteur
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    const db = readData();

    // 🔒 ANALYSE : Est-ce que cette IP a déjà voté ?
    if (db.ips[clientIp]) {
        return res.status(403).json({ success: false, message: "Vote déjà enregistré pour cette IP." });
    }

    // 🚀 AUTOMATISATION : Calcul du score
    // Si la candidate n'existe pas encore, on l'initialise à 0
    if (!db.votes[candidateId]) {
        db.votes[candidateId] = 0;
    }
    
    // On ajoute +1 au score de la candidate spécifique (ex: "02")
    db.votes[candidateId] += 1;

    // On enregistre l'IP pour interdire tout autre vote
    db.ips[clientIp] = true;

    // On sauve le tout
    saveData(db);

    res.json({ success: true, newTotal: db.votes[candidateId] });
});

// Route pour consulter les scores
app.get('/api/votes', (req, res) => {
    const db = readData();
    res.json(db.votes);
});

app.listen(3000, () => console.log("Serveur actif."));
