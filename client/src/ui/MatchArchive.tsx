import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Crosshair, Crown, Flame, Gift, Swords, Timer, TriangleAlert } from "lucide-react";
import type { Award, AwardId, MatchPlayer, Profile, SavedMatch, TableSummary } from "../../../shared/statistics";
import { guestMatchToken, matchPath, profilePath, readDemoBots, readMatch, readPlayers, readProfile, readRecentMatches,
  readTableSummary, rememberGuestMatch } from "../network/accountApi";

type Navigate = (path: string) => void;
type RouteProps = { navigate: Navigate; backToTable?: boolean; leaveTable?: () => void };
type Loader<T> = (signal: AbortSignal) => Promise<T>;
const date = new Intl.DateTimeFormat("fr", { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("fr", { maximumFractionDigits: 1 });
const seconds = new Intl.NumberFormat("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const individual = [
  ["shuriken", "Shuriken", Swords], ["luckyLuke", "Lucky Luke", Timer], ["boulet", "Le boulet", TriangleAlert],
  ["cible", "La cible", Crosshair], ["pyromane", "Le pyromane", Flame], ["roisNoirs", "Le collectionneur de Rois noirs", Crown],
  ["distributeur", "Le distributeur", Gift],
] as const;
const interactions: [AwardId, string][] = [
  ["victime", "Victime préférée"], ["rivalite", "Rivalité principale"], ["meilleur", "Meilleur échange"],
  ["pire", "Pire échange"], ["voleur", "Voleur de victoires"], ["bourreau", "Bourreau des Dutch"],
];

function Link({ path, navigate, children }: { path: string; navigate: Navigate; children: ReactNode }) {
  return <a href={path} onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  }}>{children}</a>;
}

function ArchiveFrame({ title, children, navigate, backToTable, leaveTable }: RouteProps & { title: string; children: ReactNode }) {
  return <main className="archive-screen">
    <header className="archive-header">
      <nav className="archive-actions" aria-label="Navigation">
        <Link path="/" navigate={navigate}><ArrowLeft size={17} aria-hidden="true" /> {backToTable ? "Retour à la table" : "Accueil"}</Link>
        {leaveTable && <button type="button" onClick={leaveTable}>Quitter la table</button>}
      </nav>
      <h1>{title}</h1>
    </header>
    {children}
  </main>;
}

function Load<T>({ loader, children }: { loader: Loader<T>; children: (result: T) => ReactNode }) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loader(controller.signal).then(setData, (caught: Error) => {
      if (!controller.signal.aborted) setError(caught.message);
    });
    return () => controller.abort();
  }, [attempt, loader]);
  if (error) return <div className="archive-card">
    <p role="alert">{error}</p>
    <button type="button" onClick={() => { setError(undefined); retry(attempt + 1); }}>Réessayer</button>
  </div>;
  return data !== undefined ? children(data) : <p role="status">Chargement…</p>;
}

function plural(value: number, one: string, many = one + "s") { return `${number.format(value)} ${value === 1 ? one : many}`; }
function awardValue(id: AwardId, { value, extra }: Award) {
  switch (id) {
    case "luckyLuke": return `${seconds.format(value / 1_000)} s`;
    case "cible": return `${plural(value, "action")} / ${plural(extra ?? 0, "hater")}`;
    case "pyromane": return plural(value, "carte provoquée", "cartes provoquées");
    case "roisNoirs": return plural(value, "Roi noir", "Rois noirs");
    default: return extra === undefined ? plural(value, "carte") : `${plural(value, "carte")} / ${plural(extra, "point")}`;
  }
}

function PlayerName({ player, navigate }: { player: MatchPlayer | undefined; navigate: Navigate }) {
  if (!player) return null;
  return player.accountId ? <Link path={profilePath(player.accountId)} navigate={navigate}>{player.name}</Link> : player.name;
}

function Interaction({ id, award, roster, navigate }: {
  id: AwardId; award: Award; roster: Map<string, MatchPlayer>; navigate: Navigate;
}) {
  const [a, b] = award.players.map((key) => <PlayerName key={key} player={roster.get(key)} navigate={navigate} />);
  const value = award.value;
  switch (id) {
    case "victime": return <>{a} a ciblé {b} dans {plural(value, "échange")}.</>;
    case "rivalite": return <>{a} et {b} ont effectué {plural(value, "échange")} entre leurs mains.</>;
    case "meilleur": return <>{a} a allégé sa main de {plural(value, "point")} en un échange.</>;
    case "pire": return <>{a} a pris {plural(value, "point")} de plus en un échange.</>;
    case "voleur": return <>{a} a remporté {plural(value, "manche")} après un Dutch adverse.</>;
    case "bourreau": return <>{a} a fait échouer {plural(value, "annonce Dutch", "annonces Dutch")}.</>;
    default: return null;
  }
}

function MatchContent({ match, navigate }: { match: SavedMatch; navigate: Navigate }) {
  const sorted = match.players.filter(({ rank }) => rank !== undefined).sort((a, b) => a.rank! - b.rank!);
  const roster = new Map(match.players.map((player) => [player.id, player]));
  const elapsed = Math.floor(Math.max(0, match.endedAt - match.startedAt) / 1_000);
  const duration = elapsed >= 60 ? `${Math.floor(elapsed / 60)} min ${elapsed % 60} s` : `${elapsed} s`;
  return <>
    <div className="archive-meta">
      <strong>{match.status === "finished" ? "Partie terminée" : "Partie interrompue"}</strong>
      <time dateTime={new Date(match.startedAt).toISOString()}>{date.format(match.startedAt)}</time>
      <span>{duration}</span><span>{plural(match.players.length, "joueur")}</span>
      <span>{plural(match.rounds, "manche terminée", "manches terminées")}</span>
    </div>
    {match.status === "interrupted" && <p className="archive-note">{match.partial
      ? "Bilan partiel établi avec les dernières données reçues. Certaines actions et valeurs peuvent manquer."
      : "Les actions validées avant l’interruption sont incluses. Les victoires et les Dutch réussis proviennent des manches terminées."}</p>}
    {match.unfinished && <section className="archive-card" aria-label={`Activité de la manche ${match.unfinished.round} interrompue`}>
      <h2>Manche {match.unfinished.round} interrompue</h2>
      <p>{plural(match.unfinished.reactions, "réaction valide", "réactions valides")} · {plural(match.unfinished.penalties, "pénalité")} · {plural(match.unfinished.exchanges, "échange")} · {plural(match.unfinished.gifts, "carte donnée", "cartes données")} (Joker +)</p>
    </section>}
    {sorted.length > 0 && <section className="archive-card archive-ranking">
      <h2>Classement officiel</h2>
      <table><thead><tr><th>Rang</th><th>Joueur</th><th>Total</th></tr></thead>
        <tbody>{sorted.map((player) => <tr key={player.id}>
          <td>{player.rank}</td><th scope="row"><PlayerName player={player} navigate={navigate} /></th><td>{player.total}</td>
        </tr>)}</tbody>
      </table>
    </section>}
    <section aria-labelledby="individual-title">
      <h2 id="individual-title">Récompenses individuelles</h2>
      <div className="archive-awards">{individual.map(([id, title, Icon]) => {
        const awards = match.awards[id];
        if (id === "distributeur" && !awards?.length) return null;
        return <article className="archive-card" key={id}>
          <Icon size={23} aria-hidden="true" />
          <h3>{title}</h3>
          {awards?.length ? awards.map((award) => <p key={award.players[0]}>
            <strong><PlayerName player={roster.get(award.players[0])} navigate={navigate} /></strong>
            <span>{awardValue(id, award)}</span>
          </p>) : <p className="archive-muted">Non attribuée</p>}
        </article>;
      })}</div>
    </section>
    <section aria-labelledby="interaction-title">
      <h2 id="interaction-title">Interactions et rivalités</h2>
      <dl className="archive-card archive-interactions">
        {interactions.map(([id, title]) => <div key={id}>
          <dt>{title}</dt>
          {(match.awards[id]?.length ? match.awards[id] : undefined)?.map((award) => <dd key={award.players.join(":")}>
            <Interaction id={id} award={award} roster={roster} navigate={navigate} />
          </dd>) ?? <dd className="archive-muted">Non attribuée</dd>}
        </div>)}
      </dl>
    </section>
  </>;
}

function CumulativeResults({ summary, navigate }: { summary: TableSummary; navigate: Navigate }) {
  const totals = new Map<string, { player: MatchPlayer; games: number; gameWins: number; rounds: number; wins: number;
    dutch: number; dutchWon: number; reactions: number; penalties: number; exchanges: number }>();
  let rounds = 0;
  for (const game of summary.games) {
    rounds += game.rounds;
    for (const player of game.players) {
      const id = player.accountId ?? player.id;
      const total = totals.get(id) ?? { player, games: 0, gameWins: 0, rounds: 0, wins: 0,
        dutch: 0, dutchWon: 0, reactions: 0, penalties: 0, exchanges: 0 };
      total.player = player;
      total.games++;
      if (player.rank === 1 && player.eligible !== false) total.gameWins++;
      total.rounds += player.rounds;
      total.wins += player.wins;
      total.dutch += player.dutch;
      total.dutchWon += player.dutchWon;
      total.reactions += player.reactions;
      total.penalties += player.penalties;
      total.exchanges += player.exchanges;
      totals.set(id, total);
    }
  }

  function openMatch(id: string) {
    const token = guestMatchToken(summary.match.id);
    if (token) rememberGuestMatch(id, token);
    navigate(matchPath(id));
  }

  return <section className="archive-card cumulative-results" aria-labelledby="cumulative-title">
    <h2 id="cumulative-title">Bilan cumulé de la table</h2>
    <p>{plural(summary.games.length, "partie")} · {plural(rounds, "manche terminée", "manches terminées")}</p>
    <div className="cumulative-players">
      {Array.from(totals.values(), ({ player, games, gameWins, rounds, wins, dutch, dutchWon, reactions, penalties, exchanges }) => (
        <article className="cumulative-player" key={player.accountId ?? player.id}>
          <h3><PlayerName player={player} navigate={navigate} /></h3>
          <dl>
            <div><dt>Parties gagnées</dt><dd>{gameWins} / {games}</dd></div>
            <div><dt>Manches gagnées</dt><dd>{wins} / {rounds}</dd></div>
            <div><dt>Dutch réussis</dt><dd>{dutchWon} / {dutch}</dd></div>
            <div><dt>Réactions</dt><dd>{reactions}</dd></div>
            <div><dt>Pénalités</dt><dd>{penalties}</dd></div>
            <div><dt>Échanges</dt><dd>{exchanges}</dd></div>
          </dl>
        </article>
      ))}
    </div>
    {summary.games.length > 1 && <ul className="archive-list">
      {summary.games.filter(({ id }) => id !== summary.match.id).map((game) => <li key={game.id}>
        <Link path={matchPath(game.id)} navigate={() => openMatch(game.id)}>{date.format(game.startedAt)}</Link>
        <span>{plural(game.rounds, "manche terminée", "manches terminées")}</span>
      </li>)}
    </ul>}
  </section>;
}

function InterruptedTable({ id, ...props }: RouteProps & { id: string }) {
  const loader = useCallback((signal: AbortSignal) => readTableSummary(id, signal), [id]);
  return <ArchiveFrame title="Statistiques de la partie" {...props}>
    <Load loader={loader}>{(summary) => <>
      <CumulativeResults summary={summary} navigate={props.navigate} />
      <MatchContent match={summary.match} navigate={props.navigate} />
    </>}</Load>
  </ArchiveFrame>;
}

export function MatchArchive({ id, tableSummary, ...props }: RouteProps & { id: string; tableSummary: boolean }) {
  const [loader] = useState(() => (signal: AbortSignal) => readMatch(id, signal));
  if (tableSummary) return <InterruptedTable id={id} {...props} />;
  return <ArchiveFrame title="Statistiques de la partie" {...props}>
    <Load loader={loader}>{(match) => <MatchContent match={match} navigate={props.navigate} />}</Load>
  </ArchiveFrame>;
}

function ProfileContent({ profile, navigate }: { profile: Profile; navigate: Navigate }) {
  const values: Array<[string, string | number]> = [
    ["Indice multijoueur", profile.rating], ["Parties jouées", profile.matches], ["Terminées", profile.finished],
    ["Interrompues", profile.interrupted], ["Victoires", profile.victories],
    ["Taux de victoire", profile.finished ? number.format(100 * profile.victories / profile.finished) + " %" : "—"],
    ["Manches terminées", profile.rounds], ["Manches gagnées", profile.roundWins],
    ["Score moyen par manche", profile.rounds ? number.format(profile.scoreSum / profile.rounds) : "—"],
    ["Meilleur score de manche", profile.bestScore ?? "—"], ["Dutch réussis / annoncés", `${profile.dutchWon} / ${profile.dutch}`],
    ["Réactions réussies", profile.reactions], ["Pénalités de réaction", profile.penalties], ["Échanges initiés", profile.exchanges],
  ];
  const groups: [string, Profile["rivals"]][] = [
    ["Rivaux réguliers", profile.rivals.filter(({ played }) => played >= 3).slice(0, 12)],
    ["Joueurs dominés", profile.rivals.filter(({ played, wins, losses }) => played >= 3 && wins > losses).slice(0, 8)],
    ["Bêtes noires", profile.rivals.filter(({ played, wins, losses }) => played >= 3 && losses > wins).slice(0, 8)],
  ];
  return <>
    <h2>{profile.name}</h2>
    {profile.demoBot && <p className="archive-muted">Bot de démonstration · historique initial simulé</p>}
    <dl className="archive-card profile-numbers">{values.map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <section className="archive-card">
      <h2>Évolution de l’indice</h2>
      {profile.ratings.length ? <ol className="archive-rating">{profile.ratings.map((entry, index) =>
        <li key={index}><strong>{entry.rating}</strong><time dateTime={new Date(entry.date).toISOString()}>{date.format(entry.date)}</time></li>,
      )}</ol> : <p className="archive-muted">Aucune partie comptant pour l’indice.</p>}
    </section>
    <section className="archive-card">
      <h2>Historique des confrontations</h2>
      {profile.encounters.length ? <ul className="archive-list">{profile.encounters.map((encounter, index) =>
        <li key={index}>
          <time dateTime={new Date(encounter.date).toISOString()}>{date.format(encounter.date)}</time>
          <span>{encounter.opponents.map(({ id, name, outcome }, opponent) =>
            <span key={id}>{opponent > 0 && ", "}<Link path={profilePath(id)} navigate={navigate}>{name}</Link> ({outcome > 0 ? "V" : outcome < 0 ? "D" : "N"})</span>)}</span>
        </li>,
      )}</ul> : <p className="archive-muted">Aucune confrontation terminée.</p>}
    </section>
    {groups.map(([title, rivals]) => <section key={title} className="archive-card">
      <h2>{title}</h2>
      {rivals.length ? <ul className="archive-list">{rivals.map((rival) => <li key={rival.id}>
        <Link path={profilePath(rival.id)} navigate={navigate}>{rival.name}</Link>
        <span>{plural(rival.played, "partie")} · {rival.wins} V / {rival.losses} D / {rival.played - rival.wins - rival.losses} N</span>
      </li>)}</ul> : <p className="archive-muted">Aucun résultat à afficher.</p>}
    </section>)}
  </>;
}

export function PublicProfile({ id, personal, ...props }: RouteProps & { id: string; personal?: boolean }) {
  const [loader] = useState(() => (signal: AbortSignal) => readProfile(id, signal));
  return <ArchiveFrame title={personal ? "Mes stats" : "Profil public"} {...props}>
    {personal && <div className="archive-actions"><Link path="/mes-parties" navigate={props.navigate}>Mes parties</Link></div>}
    <Load loader={loader}>{(profile) => <ProfileContent profile={profile} navigate={props.navigate} />}</Load>
  </ArchiveFrame>;
}

export function RecentMatches(props: RouteProps) {
  const [pages, setPages] = useState<Array<string | null>>([null]);
  const cursor = pages.at(-1) ?? null;
  const loader = useCallback((signal: AbortSignal) => readRecentMatches(cursor, signal), [cursor]);
  return <ArchiveFrame title="Mes parties" {...props}>
    <Load key={cursor} loader={loader}>{({ matches, next }) =>
      <section className="archive-card">{matches.length ? <ul className="archive-list">{matches.map((entry) =>
        <li key={entry.id}><Link navigate={props.navigate} path={matchPath(entry.id)}>{date.format(entry.date)}</Link>
          <span>{entry.status === "finished" ? "Terminée" : "Interrompue"}</span></li>,
      )}</ul> : <p>Aucune partie enregistrée.</p>}
        {(pages.length > 1 || next) && <nav className="archive-actions" aria-label="Pages de l’historique">
          {pages.length > 1 && <button type="button" onClick={() => setPages(pages.slice(0, -1))}>Parties plus récentes</button>}
          {next && <button type="button" onClick={() => setPages([...pages, next])}>Parties plus anciennes</button>}
        </nav>}
      </section>
    }</Load>
  </ArchiveFrame>;
}

export function PlayersDirectory(props: RouteProps) {
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState([""]);
  const cursor = pages.at(-1) ?? "";
  const loader = useCallback((signal: AbortSignal) => readPlayers(query, cursor, signal), [query, cursor]);
  return <ArchiveFrame title="Autres joueurs" {...props}>
    <form className="archive-actions player-search" onSubmit={(event) => {
      event.preventDefault();
      setQuery(String(new FormData(event.currentTarget).get("name")).trim());
      setPages([""]);
    }}>
      <label>Rechercher un pseudo <input name="name" maxLength={15} pattern="[A-Za-z0-9]+" /></label>
      <button type="submit">Rechercher</button>
    </form>
    <Load key={query + ":" + cursor} loader={loader}>{({ players, next }) => <section className="archive-card">
      {players.length ? <ul className="archive-list">{players.map((player) => <li key={player.id}>
        <Link path={profilePath(player.id)} navigate={props.navigate}>{player.name}</Link>
        <span>{player.demoBot && "Bot · "}{plural(player.matches, "partie")}</span>
      </li>)}</ul> : <p>Aucun joueur trouvé.</p>}
      {(pages.length > 1 || next) && <nav className="archive-actions" aria-label="Pages des joueurs">
        {pages.length > 1 && <button type="button" onClick={() => setPages(pages.slice(0, -1))}>Précédent</button>}
        {next && <button type="button" onClick={() => setPages([...pages, next])}>Suivant</button>}
      </nav>}
    </section>}</Load>
  </ArchiveFrame>;
}

export function DemoBots(props: RouteProps) {
  return <ArchiveFrame title="Bots de test" {...props}>
    <Load loader={readDemoBots}>{(bots) => <section className="archive-card">
      <p className="archive-muted">Profils de démonstration peuplés par des parties simulées.</p>
      <ul className="archive-list">{bots.map((bot) => <li key={bot.id}>
        <Link path={profilePath(bot.id)} navigate={props.navigate}>{bot.name}</Link>
        <span>{plural(bot.matches, "partie")}</span>
      </li>)}</ul>
    </section>}</Load>
  </ArchiveFrame>;
}
