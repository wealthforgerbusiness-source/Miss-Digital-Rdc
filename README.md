# Miss Digital RDC — Site officiel

Site statique (HTML5 / CSS3 / JS) prêt à publier sur GitHub Pages.

## Fichiers

- `index.html` — structure de la page
- `style.css` — design (palette bleu/blanc/noir, Playfair Display + Poppins)
- `script.js` — menu mobile, animations au scroll, note anti-fraude
- `assets/logo.jpg` — **logo temporaire généré automatiquement**
- `sitemap.xml` — à adapter avec votre URL finale

## À faire avant publication

1. **Remplacer le logo** : déposez votre vrai `LOGO.JPG` dans `assets/logo.jpg`
   (même nom de fichier — aucune autre modification nécessaire).
2. **Compléter la section Contact** dans `index.html` : e-mail, téléphone,
   liens Facebook / Instagram / TikTok (repérez les commentaires
   `JE VAIS COMPLETE MOI MM`).
3. **Mettre à jour l'URL réelle** dans `sitemap.xml` et dans les balises
   `<link rel="canonical">` / `og:url` de `index.html` une fois le site
   publié sur GitHub Pages (ex : `https://votre-compte.github.io/miss-digital-rdc/`).
4. **Lien des résultats** : remplacez le `href="#"` du bouton
   `#resultsLink` par le lien réel une fois les résultats disponibles.

## Publier sur GitHub Pages

1. Créez un dépôt GitHub et poussez tous ces fichiers à la racine.
2. Dans **Settings → Pages**, choisissez la branche `main` et le dossier `/root`.
3. Votre site sera en ligne à l'adresse fournie par GitHub en quelques minutes.

## ⚠️ Important — contrôle des adresses IP / anti-fraude

Un site 100% statique (GitHub Pages) **ne peut pas** vérifier de façon fiable
l'adresse IP d'un votant ni empêcher réellement les votes multiples : cela
nécessite un petit backend (API). Le fichier `script.js` contient une
explication détaillée et un point de branchement clair
(`checkVoteEligibility()`) pour connecter un vrai backend plus tard. En
attendant, le site s'appuie sur la limitation native de Google Forms
(une réponse par compte Google) comme première barrière.
