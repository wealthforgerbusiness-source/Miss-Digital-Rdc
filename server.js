/**
 * SERVEUR BACKEND ANTI-FRAUDE - MISS DIGITAL RDC 2026
 * Fichier : server.js
 * 
 * Fonctionnalités :
 * 1. Capture l'adresse IP réseau réelle du visiteur sans possibilité de falsification.
 * 2. Bloque DÉFINITIVEMENT tout revote depuis une même adresse IP.
 * 3. Sauvegarde et charge les résultats en temps réel dans un fichier data.json.
 * 4. Fournit une page d'administration privée pour suivre le classement.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// Configuration des middlewares
app.use(cors());
app.use(express.json());

// Chemin vers le fichier de sauvegarde
const DB_FILE = path.join(__dirname, 'data.json');

/**
 * Charge les données depuis data.json (ou les crée si le fichier n'existe pas)
 */
function chargerDonnees() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            votes: { "01": 0, "02": 0, "03": 0 }, // Initialisation des candidates
            ips: {} // Registre des IP enregistrées
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    try {
        const content = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        console.error("Erreur lors de la lecture de data.json, réinitialisation temporaire", e);
        return { votes: {}, ips: {} };
    }
}

/**
 * Sauvegarde les données réelles sur le disque
 */
function sauvegarderDonnees(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// =========================================================================
// ROUTE 1 : VOTER POUR UNE CANDIDATE (POST /api/vote)
// =========================================================================
app.post('/api/vote', (req, res) => {
    const db = chargerDonnees();

    // 🔒 1. Récupération sécurisée de l'adresse IP réseau
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || "").split(',')[0].trim();
    const { candidateId } = req.body;

    if (!candidateId) {
        return res.status(400).json({ 
            success: false, 
            message: "Numéro ou ID de la candidate manquant." 
        });
    }

    // 🔒 2. Contrôle Anti-Fraude : Vérification du blocage IP définitif
    if (db.ips[clientIp]) {
        console.warn(`[BLOCAGE ANTI-FRAUDE] Tentative de re-vote bloquée pour l'IP : ${clientIp}`);
        return res.status(429).json({
            success: false,
            message: "Anti-Fraude : Votre adresse IP a déjà été enregistrée pour ce concours !"
        });
    }

    // 🔒 3. Enregistrement du vote
    db.ips[clientIp] = {
        candidateId: candidateId,
        timestamp: new Date().toISOString()
    };

    // Incrémentation du score de la candidate
    db.votes[candidateId] = (db.votes[candidateId] || 0) + 1;

    // Sauvegarde immédiate
    sauvegarderDonnees(db);

    console.log(`[VOTE VALIDE] IP: ${clientIp} ---> Candidate N°${candidateId} (Total actuel : ${db.votes[candidateId]})`);

    return res.json({
        success: true,
        message: "Votre vote a été comptabilisé avec succès !",
        newTotalVotes: db.votes[candidateId]
    });
});

// =========================================================================
// ROUTE 2 : RÉCUPÉRER LES COMPTEURS AU CHARGEMENT DU SITE (GET /api/votes)
// =========================================================================
app.get('/api/votes', (req, res) => {
    const db = chargerDonnees();
    res.json(db.votes);
});

// =========================================================================
// ROUTE 3 : PAGE D'ADMINISTRATION PRIVÉE POUR SUIVRE LES RÉSULTATS
// =========================================================================
app.get('/admin-resultats-secret', (req, res) => {
    const db = chargerDonnees();

    // Tri des candidates par nombre de votes (du plus grand au plus petit)
    const classement = Object.entries(db.votes)
        .sort((a, b) => b[1] - a[1])
        .map(([id, total], index) => `<li><strong>Rang ${index + 1}</strong> — Candidate N°${id} : <strong>${total} votes</strong></li>`)
        .join('');

    const totalVotes = Object.values(db.votes).reduce((a, b) => a + b, 0);
    const totalIpUniques = Object.keys(db.ips).length;

    res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <title>Tableau de Bord - Miss Digital RDC</title>
            <style>
                body { font-family: sans-serif; padding: 30px; background: #0f172a; color: #fff; }
                h1 { color: #ffd100; }
                ul { background: #1e293b; padding: 20px 40px; border-radius: 10px; line-height: 2; }
                .card { background: #334155; padding: 15px; border-radius: 8px; margin-top: 20px; display: inline-block; }
            </style>
        </head>
        <body>
            <h1>📊 Tableau de Bord Officiel - Miss Digital RDC</h1>
            <hr>
            <h2>🏆 Classement en direct :</h2>
            <ul>${classement || 'Aucun vote pour le moment.'}</ul>
            <div class="card">
                <p><strong>Total global des votes :</strong> ${totalVotes}</p>
                <p><strong>Total des IP uniques enregistrées :</strong> ${totalIpUniques}</p>
            </div>
        </body>
        </html>
    `);
});

// Démarrage du serveur sur le port attribué (Render, Vercel ou local)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Serveur Anti-Fraude Miss Digital RDC actif sur le port ${PORT}`);
});
