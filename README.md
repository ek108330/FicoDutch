# FicoDutch
FicoDutch Card Game

## Android

FicoDutch est disponible en APK installable directement sur Android. [Installation et compilation](android/README.md)

## Tests locaux

Avec Node.js 24, npm et Microsoft Edge installés, lancez ces commandes depuis la racine du dépôt.

```powershell
npm.cmd --prefix server ci
npm.cmd --prefix client ci
npm.cmd --prefix client run build
npm.cmd --prefix client run lint -- --deny-warnings
npm.cmd --prefix client run test:unit
npm.cmd --prefix client run test:e2e
```

Les tests unitaires couvrent la distribution, la mémorisation, le tour normal, les pouvoirs, les réactions, l’annonce Dutch, les changements de manche et la reprise de session. Playwright ouvre des sessions Edge isolées sur les ports locaux 15300 et 15173.

Les captures d’écran se trouvent dans `client/test-results/` après chaque exécution. Les scénarios capturent la table sur ordinateur et sur mobile, en portrait et en paysage. Ils vérifient la fin du tour et du pouvoir avec leur délai réel de 60 secondes.

Le scénario des comptes, des profils et des bilans utilise une base PostgreSQL embarquée isolée. Lancez `npm.cmd --prefix client run test:e2e:accounts` pour le rejouer. Le workflow GitHub Actions exécute les deux suites de navigateur avec Chromium sous Linux.

## Comptes et bilans

Renseignez `DATABASE_URL` dans les variables d’environnement du service Render avec l’URL de sa base PostgreSQL durable. FicoDutch crée son schéma au démarrage. Les comptes, profils et bilans survivent au redéploiement. Les Hubs en cours restent liés au processus du serveur. Gardez la chaîne de connexion dans les secrets Render.

Pour essayer la persistance sur un poste de développement après installation des dépendances, compilez le client et démarrez le serveur avec une base locale. Le dossier `server/.ficodutch-db/` créé par le serveur est ignoré par Git.

```powershell
npm.cmd --prefix client run build
$env:FICODUTCH_LOCAL_DB = ".ficodutch-db"
$env:SERVE_CLIENT = "1"
$env:HOST = "127.0.0.1"
$env:CLIENT_ORIGINS = "http://localhost:3000"
npm.cmd --prefix server start
```

Ouvrez ensuite `http://localhost:3000`. Sans configuration de base de données, le jeu conserve l’accès par pseudo.

Avec PostgreSQL, un invité peut aussi jouer avec un pseudo libre. Les identifiants et pseudos des comptes sont réservés, tout comme le pseudo d’un invité déjà à une table. Un invité retrouve le bilan dans l’onglet de sa partie.

Définissez `FICODUTCH_DEMO=1` sur une base de test pour peupler dix profils de bots avec 100 parties jouées par le moteur. Le chargement ne rajoute pas de doublons au redémarrage. Ces profils sont accessibles via **Bots de test** et servent aux bots ajoutés dans les Hubs.

L’appareil hôte conserve le journal privé et calcule les récompenses. Pendant la partie, il envoie un point de reprise sans données de cartes secrètes au plus une fois toutes les vingt secondes en cas de changement. La clôture enregistre le bilan calculé avant de fermer le Hub. Après une disparition de l’hôte, le bilan récupéré signale les données manquantes. Les bilans sont réservés aux participants connectés. Les profils publics présentent les statistiques et l’historique des confrontations. L’indice compare les participants humains présents du début à la fin d’une partie terminée et repose sur la validation de l’hôte.

## Préproduction

### Sur Render

Le fichier `render.yaml` crée un seul service Web Node.js, sur l’offre gratuite et dans la région de Francfort. Le service compile le client, sert le jeu et la signalisation Socket.IO sous la même adresse HTTPS, puis vérifie `/healthz`.

1. Publiez dans GitHub le commit qui contient `render.yaml` et le code de la préproduction.
2. Dans le tableau de bord Render, choisissez **New > Blueprint**. Connectez GitHub, autorisez l’accès au dépôt **FicoDutch**, puis sélectionnez le dépôt et la branche publiée. Cliquez sur **Deploy Blueprint**.
3. Quand le service est **Live**, ouvrez l’adresse `https://…onrender.com` et vérifiez qu’une visite de `/healthz` affiche `{"status":"online"}`.

L’origine Render est autorisée automatiquement par le serveur. Si vous utilisez un domaine personnalisé, indiquez la ou les origines exactes dans la variable `CLIENT_ORIGINS`, séparées par des virgules. Pour publier une nouvelle version, sélectionnez **Manual Deploy > Deploy latest commit** sur le service. Les Hubs sont en mémoire. Un redéploiement ferme les Hubs en cours.

La version affichée en haut de l’accueil et du Hub contient les sept premiers caractères du commit compilé. Comparez ce suffixe au commit affiché par Render et vérifiez qu’il est identique sur les deux appareils avant un essai. Si un onglet ancien tente de créer ou de rejoindre un Hub, le serveur demande de recharger la page.

### Sur un autre hébergement ou en local

Pour servir le client et Socket.IO sous la même origine, compilez le client puis démarrez le serveur avec les variables suivantes depuis la racine du dépôt. Remplacez le domaine d’exemple par celui de la préproduction.

```powershell
npm.cmd --prefix client run build
$env:SERVE_CLIENT = "1"
$env:CLIENT_ORIGINS = "https://ficodutch-test.example"
npm.cmd --prefix server start
```

Placez le serveur derrière un proxy HTTPS qui transmet les connexions WebSocket. La route `/healthz` fournit un contrôle de disponibilité. Pour un essai local sur le port par défaut, définissez `CLIENT_ORIGINS` à `http://localhost:3000`. Si le client et le serveur ont des domaines distincts, renseignez `VITE_SERVER_URL` avec l’URL HTTPS du serveur avant la compilation et ajoutez l’origine du client à `CLIENT_ORIGINS`.

Les navigateurs tentent d’abord une connexion directe WebRTC. Si elle ne s’établit pas, ils échangent des messages chiffrés avec des clés temporaires via Socket.IO. Le serveur central relaie les messages chiffrés. `VITE_STUN_URL` permet de configurer un serveur STUN facultatif avant la compilation. Testez le lancement et la reconnexion sur deux téléphones reliés à des réseaux différents.

## Reprendre une partie

Un invité retrouve sa place et son état de jeu dans le même onglet après une coupure ou un rechargement. La table continue de jouer et applique le délai normal de chaque tour.

Si l’hôte perd sa connexion, la table se met en pause. L’hôte doit garder son onglet d’origine ouvert pour reprendre. Si la connexion revient dans les deux minutes, le chronomètre de jeu reprend au temps restant. Après deux minutes, le Hub se ferme et, avec les comptes activés, un bilan partiel est disponible pour les participants.

## Rejoindre une partie en cours

Si le Hub a une place libre, un nouvel invité peut la réserver et attendre la prochaine distribution. Son score de départ est le total le plus élevé à la fin de la manche précédente. Si la partie atteint son seuil de fin, la liste des Hubs indique que la table est terminée.

## Gérer la table

Le bouton **Gérer la table** permet à l’hôte de retirer un invité du Hub. En cours de manche, sa main reste sur la table jusqu’à la prochaine distribution et le jeu passe au joueur suivant si c’était son tour. Le retrait annule la session de l’invité. Il peut rejoindre de nouveau tant que le Hub accepte des joueurs.

En cours de partie, l’hôte peut aussi confirmer l’interruption. Avec PostgreSQL, le Hub enregistre le bilan avant de se fermer et l’affiche aux participants. Sans base de données, les joueurs reviennent à l’accueil.

## Chat et emojis

Dans la salle d’attente, les membres du Hub peuvent échanger du texte et des emojis. Les messages s’affichent à mesure qu’ils arrivent et ne sont pas enregistrés. À la table, le menu **Emojis** affiche une réaction temporaire près du nom du joueur.
