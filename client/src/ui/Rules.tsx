
import { ArrowLeft, BookOpen } from "lucide-react";

type RulesProps = {
  onBack: () => void;
  titleId: string;
};

function Rules({ onBack, titleId }: RulesProps) {
  return (
    <main className="rules-page">
      <header className="rules-header">
        <button className="back-button" onClick={onBack} autoFocus>
          <ArrowLeft size={18} />
          Retour
        </button>

        <h1 id={titleId}>
          <BookOpen size={25} />
          Règles du FicoDutch
        </h1>

      </header>

      <nav className="rules-content">
        <section>
          <h2>1. Objectif et matériel</h2>
          <p>
            Le but du FicoDutch est de terminer la partie avec le
            score cumulé le plus faible.
          </p>
          <ul>
            <li>De 2 à 6 joueurs.</li>
            <li>Un jeu classique de 52 cartes.</li>
            <li>Deux Jokers supplémentaires avec la variante Joker+.</li>
            <li>4 cartes par joueur par défaut, ou 6 avec la variante correspondante.</li>
          </ul>
          <p>
            Chaque joueur cherche à mémoriser ses cartes, à remplacer
            celles qui ont une valeur élevée et à terminer la manche
            avec le moins de points possible.
          </p>
        </section>

        <section>
          <h2>2. Valeur des cartes</h2>
          <ul>
            <li>As : 1 point.</li>
            <li>Cartes de 2 à 10 : valeur indiquée.</li>
            <li>Valet : 11 points.</li>
            <li>Dame : 12 points.</li>
            <li>Roi rouge : 13 points.</li>
            <li>Roi noir : 0 point.</li>
            <li>Joker : 14 points.</li>
          </ul>
          <p>
            Les points des cartes encore en main sont comptabilisés
            à la fin de la manche.
          </p>
        </section>

        <section>
          <h2>3. Préparation et mémorisation</h2>
          <p>
            Au début de chaque manche, chaque joueur reçoit 4 cartes
            face cachée. Avec la variante 6 cartes, il en reçoit 6.
          </p>
          <p>
            Une phase de mémorisation simultanée de 15 secondes
            commence ensuite.
          </p>
          <ul>
            <li>Chaque joueur peut choisir 2 cartes à regarder, ou 3 avec la variante 6 cartes.</li>
            <li>Il peut masquer et revoir les cartes choisies pendant les 15 secondes.</li>
            <li>Les cartes se cachent automatiquement à la fin du délai.</li>
            <li>Ne pas regarder toutes les cartes autorisées n'entraîne aucune pénalité.</li>
            <li>Chaque joueur ne peut voir que ses propres cartes pendant cette phase.</li>
          </ul>
        </section>

        <section>
          <h2>4. Déroulement d'un tour</h2>
          <p>
            Le premier joueur de la première manche est tiré au sort.
            Chaque joueur dispose ensuite de 60 secondes pour prendre
            une carte et terminer son action.
          </p>
          <ol>
            <li>Il prend la carte du dessus de la pioche.</li>
            <li>Il peut la glisser sur une de ses cartes. La carte remplacée rejoint alors la défausse.</li>
            <li>Il peut aussi glisser la carte piochée directement sur la défausse.</li>
          </ol>
          <p>
            Une carte spéciale déclenche son pouvoir lorsqu'elle est
            défaussée normalement, y compris si le joueur choisit
            de défausser directement la carte piochée.
          </p>
          <p>
            Les réactions ne déclenchent pas les pouvoirs spéciaux.
          </p>
        </section>

        <section>
          <h2>5. Pouvoirs spéciaux</h2>
          <ul>
            <li>
              <strong>8 — Vision personnelle :</strong> regarder une de ses propres cartes.
            </li>
            <li>
              <strong>9 — Vision adverse :</strong> regarder une carte d'un adversaire.
            </li>
            <li>
              <strong>10 — Échange :</strong> échanger deux cartes quelconques, qu'elles appartiennent au même joueur ou à deux joueurs différents.
            </li>
            <li>
              <strong>Valet — Vision et échange :</strong> regarder une carte, puis éventuellement échanger deux cartes quelconques.
            </li>
            <li>
              <strong>Joker — Carte supplémentaire :</strong> choisir un autre joueur et lui ajouter une carte aléatoire de la pioche, face cachée. Il ne peut pas la regarder immédiatement.
            </li>
          </ul>
          <p>Avec le 8 ou le 9, la carte reste visible au plus 10 secondes. Touche-la pour la retourner plus tôt et terminer ton tour. Le compte à rebours est visible de tous.</p>
          <p>
            La carte ajoutée par le Joker compte dans le score final.
            Un joueur ayant quitté volontairement la partie peut
            également être ciblé tant que ses cartes sont encore présentes.
          </p>
          <p>
            La phase d'utilisation d'un pouvoir dispose de 60 secondes
            supplémentaires. Si le délai expire, le pouvoir est annulé,
            les cartes sélectionnées sont restaurées et le tour passe
            au joueur suivant.
          </p>
        </section>

        <section>
          <h2>6. Réactions à la défausse</h2>
          <p>
            Lorsqu'une carte est défaussée, les joueurs peuvent tenter
            une réaction en touchant trois fois rapidement une carte correspondante ou en la glissant vers le centre de la table.
          </p>
          <p>
            Une réaction valide devient la nouvelle carte de référence
            pour les réactions suivantes. Une réaction ne déclenche
            pas le pouvoir spécial de la carte posée.
          </p>
          <ul>
            <li>La première réaction valide reçue par l'hôte est prioritaire.</li>
            <li>Une tentative reçue après le changement de la défausse laisse la main intacte.</li>
            <li>Une réaction invalide entraîne la récupération de la carte tentée et l'ajout d'une carte de pénalité aléatoire face cachée.</li>
            <li>La chaîne de réactions continue à partir de la dernière défausse valide.</li>
            <li>Après la fin du dernier tour, la dernière défausse ouvre une fenêtre de réaction de 3 secondes avant le calcul des scores.</li>
          </ul>
          <p>
            La variante Pose infinie permet de poursuivre les réactions
            sans limite, y compris pour un même joueur.
          </p>
          <p>
            Une réaction peut passer avant la sélection des deux cibles du 10
            ou du Valet. Une fois les deux cibles du Valet validées,
            elles restent réservées jusqu'à la décision du joueur.
          </p>
          <p>
            La règle de base demande une carte du même rang.
            Avec la variante +1 / -1, seules les cartes de rang
            immédiatement supérieur ou inférieur peuvent réagir.
            La suite numérique est circulaire :
            As, 2, 3, 4, 5, 6, 7, 8, 9, 10, Valet, Dame, Roi, As.
            Les deux rois ont la valeur numérique 13 pour cette variante.
          </p>
        </section>

        <section>
          <h2>7. Gestion des situations particulières</h2>
          <ul>
            <li>
              <strong>Pioche épuisée :</strong> la défausse est mélangée pour reformer une pioche, en conservant visible sa carte supérieure.
            </li>
            <li>
              <strong>Fin de tour :</strong> à l'expiration des 60 secondes, toute carte tirée encore en attente rejoint la défausse et le tour passe automatiquement.
            </li>
            <li>
              <strong>Déconnexion :</strong> un joueur déconnecté conserve ses cartes et son score. Son tour est passé si nécessaire.
            </li>
            <li>
              <strong>Retour en ligne :</strong> il retrouve sa place et peut participer aux réactions dès sa reconnexion.
            </li>
            <li>
              <strong>Départ volontaire :</strong> le joueur ne joue plus et ne réagit plus, mais ses cartes restent présentes et peuvent être échangées ou ciblées.
            </li>
          </ul>
          <p>
            Si l'hôte se déconnecte, la partie est mise en pause
            pendant 2 minutes. Sans reconnexion dans ce délai,
            le Hub et la partie prennent fin. Un départ volontaire
            de l'hôte met fin immédiatement au Hub.
          </p>
        </section>

        <section>
          <h2>8. Annonce Dutch</h2>
          <p>
            À la fin de son tour, un joueur qui pense avoir le score
            le plus faible peut annoncer Dutch.
          </p>
          <p>L’icône près du nom prépare l’annonce. À la fin du tour, elle s’affiche pour tous les joueurs et déclenche un son.</p>
          <ul>
            <li>Les autres joueurs disposent d'un dernier tour.</li>
            <li>Le joueur ayant annoncé Dutch ne rejoue pas.</li>
            <li>Il est protégé contre les échanges forcés de ses cartes.</li>
            <li>Le Valet peut toujours consulter ses cartes. L’échange est alors indisponible.</li>
            <li>Il peut néanmoins participer aux réactions.</li>
          </ul>
          <p>
            Si le joueur ayant annoncé Dutch n'a pas le score le plus
            faible à la fin de la manche, il reçoit une pénalité
            supplémentaire de 10 points.
          </p>
          <p>
            En cas d'égalité pour le score le plus faible, le joueur
            ayant annoncé Dutch n'est pas considéré comme seul
            détenteur du score minimum : il reçoit donc la pénalité.
          </p>
        </section>

        <section>
          <h2>9. Fin d'une manche et égalités</h2>
          <p>
            Si un joueur se débarrasse de sa dernière carte, la manche
            se termine immédiatement.
          </p>
          <ul>
            <li>Si ce joueur est le seul à obtenir 0 point, il gagne la manche avec 0 point.</li>
            <li>Si un autre joueur obtient également 0 point, le joueur ayant vidé sa main reçoit 10 points de pénalité.</li>
            <li>Les autres joueurs comptabilisent la valeur de leurs cartes restantes.</li>
          </ul>
          <p>
            Cette règle s'applique même si un autre joueur possède
            un ou plusieurs rois noirs.
          </p>
          <p>
            Si la dernière carte défaussée est une carte spéciale,
            son pouvoir ne se déclenche pas. La manche s'arrête
            immédiatement.
          </p>
          <p>
            Si un joueur vide sa main à la suite d'un échange effectué
            avec un 10 ou un Valet, la manche s'arrête également
            immédiatement et aucun pouvoir supplémentaire ne se déclenche.
          </p>
        </section>

        <section>
          <h2>10. Variantes disponibles</h2>
          <ul>
            <li><strong>6 cartes :</strong> chaque joueur reçoit 6 cartes et peut en regarder 3 pendant la mémorisation.</li>
            <li><strong>Pose infinie :</strong> les réactions peuvent s'enchaîner sans limite.</li>
            <li><strong>+1 / -1 :</strong> seules les cartes de rang immédiatement supérieur ou inférieur peuvent réagir.</li>
            <li><strong>Joker+ :</strong> deux Jokers sont ajoutés au paquet.</li>
          </ul>
          <p>
            Toutes les variantes sont indépendantes et peuvent être
            combinées. Elles sont désactivées par défaut.
          </p>
          <p>
            L'hôte peut modifier les variantes avant une manche,
            notamment pendant la phase de résultats. Une modification
            ne s'applique qu'à la manche suivante.
          </p>
        </section>

        <section>
          <h2>11. Fin de partie et classement</h2>
          <p>
            Le seuil de fin de partie est fixé par défaut à 100 points.
            L'hôte peut choisir un autre seuil ou décider de jouer
            sans limite de points.
          </p>
          <p>
            Lorsqu'un joueur atteint ou dépasse le seuil, la manche
            en cours se termine normalement avant la fin de la partie.
          </p>
          <p>
            Le joueur ayant le score cumulé le plus faible remporte
            la partie. En cas d'égalité au plus faible score,
            les joueurs concernés sont co-vainqueurs.
          </p>
        </section>
      </nav>
    </main>
  );
}

export default Rules;
