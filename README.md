# FicoDutch
FicoDutch Card Game

## Tests locaux

Avec Node.js, npm et Microsoft Edge installés, lancez ces commandes depuis la racine du dépôt.

```powershell
npm.cmd --prefix client ci
npm.cmd --prefix client run test:unit
npm.cmd --prefix client run test:e2e
```

Les tests unitaires couvrent la distribution, la mémorisation, le tour normal, les pouvoirs, les réactions, l’annonce Dutch, les changements de manche et la reprise de session. Playwright ouvre deux sessions Edge isolées sur les ports locaux 15300 et 15173.

Les captures d’écran se trouvent dans `client/test-results/` après chaque exécution. Les scénarios capturent la table sur ordinateur et sur mobile, en portrait et en paysage. Ils vérifient la fin du tour et du pouvoir avec leur délai réel de 60 secondes.

Les cartes révélées à l’invité passent par WebRTC. Pour un essai entre réseaux distincts, un serveur STUN peut être configuré avec la variable `VITE_STUN_URL` côté client.

## Reprendre une partie

Un invité retrouve sa place et son état de jeu dans le même onglet après une coupure ou un rechargement. La table continue de jouer et applique le délai normal de chaque tour.

Si l’hôte perd sa connexion, la table se met en pause. L’hôte doit garder son onglet d’origine ouvert pour reprendre. Si la connexion revient dans les deux minutes, le chronomètre de jeu reprend au temps restant. Après deux minutes, le Hub se ferme.

## Rejoindre une partie en cours

Si le Hub a une place libre, un nouvel invité peut la réserver et attendre la prochaine distribution. Son score de départ est le total le plus élevé à la fin de la manche précédente. Si la partie atteint son seuil de fin, la liste des Hubs indique que la table est terminée.

## Gérer la table

Le bouton **Gérer la table** permet à l’hôte de retirer un invité du Hub. En cours de manche, sa main reste sur la table jusqu’à la prochaine distribution et le jeu passe au joueur suivant si c’était son tour. Le retrait annule la session de l’invité. Il peut rejoindre de nouveau tant que le Hub accepte des joueurs.

En cours de partie, l’hôte peut aussi confirmer l’interruption. Le Hub ferme et renvoie tous les joueurs à l’accueil.

## Chat et emojis

Dans la salle d’attente, les membres du Hub peuvent échanger du texte et des emojis. Les messages s’affichent à mesure qu’ils arrivent et ne sont pas enregistrés. À la table, le menu **Emojis** affiche une réaction temporaire près du nom du joueur.
