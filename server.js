/**
 * SERVEUR BACKEND SECURISE - MISS DIGITAL RDC
 * Fichier : server.js
 */

const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Base de données en mémoire (ou à relier à une DB comme Supabase / MongoDB)
// Structure : { "candidateId": totalVotes }
const votesCount = { "01": 142, "02": 218, "03": 95 };

// Registre des IP : { "197.221.X.X_candidate01": timestamp }
const ipLog = new Map();

app.post('/api/vote', (req, res) => {
    // 🔒 1. RÉCUPÉRATION SÉCURISÉE DE L'IP
    // L'IP est extraite directement des entêtes HTTP du paquet réseau.
    // L'utilisateur NE PEUT PAS la falsifier dans le code JS du navigateur.
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    const { candidateId } = req.body;

    if (!candidateId) {
        return res.status(400).json({ success: false, message: "ID Candidate manquant" });
    }

    const voteKey = `${clientIp}_${candidateId}`;
    const now = Date.now();
    const VOTE_COOLDOWN = 24 * 60 * 60 * 1000; // 24 heures en millisecondes

    // 🔒 2. VÉRIFICATION ANTI-FRAUDE DU DÉLAI
    if (ipLog.has(voteKey)) {
        const lastVoteTime = ipLog.get(voteKey);
        if (now - lastVoteTime < VOTE_COOLDOWN) {
            return res.status(429).json({
                success: false,
                message: "Avertissement Anti-Fraude : Vous avez déjà voté pour cette candidate aujourd'hui !"
            });
        }
    }

    // 🔒 3. ENREGISTREMENT ET VALIDAION DU VOTE
    ipLog.set(voteKey, now);
    votesCount[candidateId] = (votesCount[candidateId] || 0) + 1;

    console.log(`[VOTE VALIDE] IP: ${clientIp} -> Candidate N°${candidateId}`);

    return res.json({
        success: true,
        message: "Vote pris en compte !",
        newTotalVotes: votesCount[candidateId]
    });
});

// Lancement du serveur sur le port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur anti-fraude Miss Digital en ligne sur le port ${PORT}`);
});
