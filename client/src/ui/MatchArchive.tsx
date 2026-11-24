import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Crosshair, Crown, Gift, Swords, Timer, TriangleAlert } from "lucide-react";
import type { Award, AwardId, MatchPlayer, Profile, RatingMovement, SavedMatch } from "../../../shared/statistics";
import { matchPath, profilePath, readDemoBots, readMatch, readPlayers, readPodium, readProfile, readRecentMatches, reportProfile,
  readTableSummary, tableSummaryPath } from "../network/accountApi";
import PlayerAvatar from "./PlayerAvatar";
import { describeCardFace, suits } from "./cardLabels";
import type { CardRank } from "../game/cards";

type Navigate = (path: string) => void;
type RouteProps = { navigate: Navigate; backToTable?: boolean; leaveTable?: () => void };
type Loader<T> = (signal: AbortSignal) => Promise<T>;
const date = new Intl.DateTimeFormat("fr", { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("fr", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("fr", { style: "percent", maximumFractionDigits: 1 });
const seconds = new Intl.NumberFormat("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const individual = [
  ["shuriken", "Le défausseur", Swords], ["luckyLuke", "Lucky Lucke", Timer], ["boulet", "Le boulet", TriangleAlert],
  ["cible", "Cible dans le dos", Crosshair], ["roisNoirs", "Mr. Roinoir", Crown],
  ["distributeur", "Le distributeur", Gift],
] as const;
const interactions: [AwardId, string][] = [
  ["victime", "Victime préférée"], ["rivalite", "Rivalité principale"],
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
    case "luckyLuke": return `en ${seconds.format(value / 1_000)} s`;
    case "cible": return `avec ${plural(value, "action")} de ${plural(extra ?? 0, "adversaire")}`;
    case "roisNoirs": return `avec ${plural(value, "roi noir", "rois noirs")}`;
    default: return `avec ${plural(value, "carte")}${extra === undefined ? "" : ` pour ${plural(extra, "point")}`}`;
  }
}

function exchangeCard(id: string) {
  if (id.startsWith("joker-")) return "un joker";
  const [suit, rank] = id.split("-") as [keyof typeof suits, CardRank];
  if (rank === "K" && (suit === "clubs" || suit === "spades")) return "un roi noir";
  const article = rank === "Q" ? "une" : "un";
  return `${article} ${describeCardFace({ rank }).toLocaleLowerCase("fr")}`;
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
    case "rivalite": return <>{a} et {b} ont effectué {plural(value, "échange")}.</>;
    case "pire": return award.exchange
      ? <>{a} a donné {exchangeCard(award.exchange.given)} à <PlayerName player={roster.get(award.exchange.opponentId)}
        navigate={navigate} /> contre {exchangeCard(award.exchange.received)}.</>
      : <>{a} a pris {plural(value, "point")} de plus en un échange.</>;
    case "voleur": return <>{a} a remporté {plural(value, "manche")} après un Dutch adverse.</>;
    case "bourreau": return <>{a} a fait échouer {plural(value, "annonce Dutch", "annonces Dutch")}.</>;
    default: return null;
  }
}

const ratingDelta = new Intl.NumberFormat("fr", { maximumFractionDigits: 2, signDisplay: "always" });

function MatchRatingMovements({ movements, navigate }: { movements: RatingMovement[]; navigate: Navigate }) {
  const changes = movements.map(({ delta }) => delta);
  const extremes = [
    { title: "Plus fort gain de RN", delta: Math.max(0, ...changes), Icon: ArrowUpRight },
    { title: "Plus forte perte de RN", delta: Math.min(0, ...changes), Icon: ArrowDownRight },
  ];
  return <section className="archive-awards archive-rating-movements" aria-label="Variations de l’indice RN">
    {extremes.map(({ title, delta, Icon }) => <article className="archive-card" key={title}>
      <h3><Icon size={16} aria-hidden="true" />{title}</h3>
      {delta ? <p>
        <strong>{movements.filter((entry) => entry.delta === delta).map(({ accountId, name }, index) =>
          <Fragment key={accountId}>{index > 0 && " & "}<Link path={profilePath(accountId)} navigate={navigate}>{name}</Link></Fragment>,
        )}</strong>
        <span className="archive-rn-delta">{Math.abs(delta) < 0.005 ? `${delta > 0 ? "+" : "−"}<0,01` : ratingDelta.format(delta)} RN</span>
      </p> : <p className="archive-muted">{movements.length ? "Aucune variation" : "Aucune manche classée"}</p>}
    </article>)}
  </section>;
}

function MatchContent({ match, navigate }: { match: SavedMatch; navigate: Navigate }) {
  const sorted = match.players.filter(({ rank }) => rank !== undefined).sort((a, b) => a.rank! - b.rank!);
  const roster = new Map(match.players.map((player) => [player.id, player]));
  const rounds = match.totalRounds ?? match.rounds + Number(!!match.unfinished);
  const activity = match.unfinished;
  const elapsed = Math.floor(Math.max(0, match.endedAt - match.startedAt) / 1_000);
  const duration = elapsed >= 60 ? `${Math.floor(elapsed / 60)} min ${elapsed % 60} s` : `${elapsed} s`;
  return <>
    <div className="archive-meta" role="group" aria-label="Totaux">
      <span>{duration}</span>
      <span>{plural(match.playerCount ?? match.players.length, "joueur")}</span>
      <span>{plural(rounds, "manche")}</span>
      <span>{plural(match.games ?? 1, "partie")}</span>
    </div>
    {match.scopeIncomplete && <p className="archive-note">Seules les statistiques de la dernière partie sont disponibles pour cette ancienne table.</p>}
    {match.partial && <p className="archive-note">Bilan partiel établi avec les dernières données reçues. Certaines actions et valeurs peuvent manquer.</p>}
    {activity && !!(activity.reactions || activity.penalties || activity.exchanges || activity.gifts) &&
      <section className="archive-card" aria-label={`Activité de la manche ${activity.round} interrompue`}>
      <h2>Manche {activity.round} interrompue</h2>
      <p>{plural(activity.reactions, "réaction valide", "réactions valides")} · {plural(activity.penalties, "pénalité")} · {plural(activity.exchanges, "échange")} · {plural(activity.gifts, "carte donnée", "cartes données")} (Joker +)</p>
    </section>}
    {sorted.length > 0 && <section className="archive-card archive-ranking">
      <h2>Classement officiel</h2>
      {match.status === "interrupted" && <p>Dernière partie terminée</p>}
      <table><thead><tr><th>Rang</th><th>Joueur</th><th>Total</th></tr></thead>
        <tbody>{sorted.map((player) => <tr key={player.id}>
          <td>{player.rank}</td><th scope="row"><PlayerName player={player} navigate={navigate} /></th><td>{player.total}</td>
        </tr>)}</tbody>
      </table>
    </section>}
    <MatchRatingMovements movements={match.ratingMovements ?? []} navigate={navigate} />
    <section aria-labelledby="individual-title">
      <h2 id="individual-title">Récompenses individuelles</h2>
      <div className="archive-awards">{individual.map(([id, title, Icon]) => {
        const awards = match.awards[id];
        return <article className="archive-card" key={id}>
          <h3><Icon size={16} aria-hidden="true" />{title}</h3>
          {awards?.length && id === "roisNoirs" ? <p>
            <strong>{awards.map((award, index) => <Fragment key={award.players[0]}>
              {index > 0 && " & "}<PlayerName player={roster.get(award.players[0])} navigate={navigate} />
            </Fragment>)}</strong>{" "}{awardValue(id, awards[0])}.
          </p> : awards?.length ? awards.map((award) => <p key={award.players[0]}>
            <strong><PlayerName player={roster.get(award.players[0])} navigate={navigate} /></strong>{" "}
            {awardValue(id, award)}.
          </p>) : <p className="archive-muted">Non attribuée</p>}
        </article>;
      })}</div>
    </section>
    <section aria-labelledby="interaction-title">
      <h2 id="interaction-title">Interactions et rivalités</h2>
      <dl className="archive-interactions">
        {interactions.map(([id, title]) => <div className="archive-card" key={id}>
          <dt>{title}</dt>
          {(match.awards[id]?.length ? match.awards[id] : undefined)?.map((award) => <dd key={award.players.join(":")}>
            <Interaction id={id} award={award} roster={roster} navigate={navigate} />
          </dd>) ?? <dd className="archive-muted">Non attribuée</dd>}
        </div>)}
      </dl>
    </section>
    {match.status === "interrupted" && <button type="button" className="archive-home-button" onClick={() => navigate("/")}>
      <ArrowLeft size={17} aria-hidden="true" /> Revenir à l’accueil
    </button>}
  </>;
}

export function MatchArchive({ id, tableSummary, ...props }: RouteProps & { id: string; tableSummary: boolean }) {
  const loader = useCallback((signal: AbortSignal) => (tableSummary ? readTableSummary : readMatch)(id, signal), [id, tableSummary]);
  return <ArchiveFrame title="Statistiques de la partie" {...props}>
    <Load loader={loader}>{(match) => <MatchContent match={match} navigate={props.navigate} />}</Load>
  </ArchiveFrame>;
}

function ratingLevel(rating: number) {
  if (rating < 30) return "Débutant";
  if (rating < 60) return "Challenger";
  if (rating < 80) return "Expert";
  if (rating < 95) return "Maître";
  return "Légende";
}

function RatingHistory({ ratings }: Pick<Profile, "ratings">) {
  if (!ratings.length) return <p className="archive-muted">Aucune manche classée.</p>;
  const values = ratings.map(({ rating }) => rating);
  const best = Math.max(...values);
  const lowest = Math.min(...values);
  const step = [5, 10, 20].find((interval) => best - lowest <= 4 * interval) ?? 25;
  const floor = Math.max(0, Math.floor((lowest - 1) / step) * step);
  const ceiling = Math.min(100, Math.ceil((best + 1) / step) * step);
  const left = 40;
  const right = 308;
  const top = 12;
  const bottom = 116;
  const last = ratings.length - 1;
  const x = (index: number) => last ? left + (right - left) * index / last : (left + right) / 2;
  const y = (rating: number) => bottom - (bottom - top) * (rating - floor) / (ceiling - floor);
  const ticks = Array.from({ length: (ceiling - floor) / step + 1 }, (_, index) => floor + index * step);
  const roundTicks = [...new Set([0, Math.floor(last / 2), last])];

  return <svg className="archive-rating-chart" viewBox="0 0 320 150" role="img"
    aria-label="Évolution du RN sur les dernières manches classées">
    <desc>{ratings.length} manches, du RN {number.format(values[0])} au RN {number.format(values[last])}.</desc>
    <g className="rating-chart-grid">
      {ticks.map((rating) => <line key={rating} x1={left} y1={y(rating)} x2={right} y2={y(rating)} />)}
      <line x1={left} y1={top} x2={left} y2={bottom} />
    </g>
    <g className="rating-chart-labels">
      <text transform={`translate(11 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle">Indice RN</text>
      {ticks.map((rating) => <text key={rating} x={left - 5} y={y(rating)} dominantBaseline="central" textAnchor="end">{rating}</text>)}
      {roundTicks.map((index) => <text key={index} x={x(index)} y={bottom + 12} textAnchor="middle">{index + 1}</text>)}
      <text x={(left + right) / 2} y={145} textAnchor="middle">Manches classées</text>
    </g>
    {last > 0 && <polyline className="rating-chart-line" points={values.map((rating, index) => `${x(index)},${y(rating)}`).join(" ")} />}
    {ratings.map((entry, index) => <circle className="rating-chart-point" key={index} cx={x(index)} cy={y(entry.rating)}
      r={index === last ? 3 : 2}>
      <title>{`${number.format(entry.rating)} RN · ${date.format(entry.date)}`}</title>
    </circle>)}
  </svg>;
}

function ProfileContent({ profile, navigate }: { profile: Profile; navigate: Navigate }) {
  const rating = Math.round(profile.rating);
  const values: Array<[string, string | number]> = [
    ["Indice RN", `${rating} · ${ratingLevel(rating)}`], ["Parties jouées", profile.matches], ["Terminées", profile.finished],
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
    <div className="profile-identity">
      <PlayerAvatar id={profile.id} name={profile.name} style={profile.avatarStyle} photoId={profile.avatarPhotoId} />
      <h2>{profile.name}</h2>
    </div>
    {profile.demoBot && <p className="archive-muted">Bot de démonstration · historique initial simulé</p>}
    <dl className="archive-card profile-numbers">{values.map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <section className="archive-card">
      <h2>Évolution de l’indice RN</h2>
      <RatingHistory ratings={profile.ratings} />
    </section>
    {groups.map(([title, rivals]) => <section key={title} className="archive-card">
      <h2>{title}</h2>
      {rivals.length ? <ul className="archive-list">{rivals.map((rival) => <li key={rival.id}>
        <Link path={profilePath(rival.id)} navigate={navigate}>{rival.name}</Link>
        <span>RN {Math.round(rival.rating)} · {plural(rival.played, "partie")} · {rival.wins} V / {rival.losses} D / {rival.played - rival.wins - rival.losses} N</span>
      </li>)}</ul> : <p className="archive-muted">Aucun résultat à afficher.</p>}
    </section>)}
  </>;
}

export function PublicProfile({ id, personal, canReport, ...props }: RouteProps & { id: string; personal?: boolean; canReport?: boolean }) {
  const [loader] = useState(() => (signal: AbortSignal) => readProfile(id, signal));
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  async function report() {
    setReporting(true);
    try {
      await reportProfile(id);
      setReported(true);
      setReportStatus("Signalement transmis pour vérification.");
    } catch (error) {
      setReportStatus(error instanceof Error ? error.message : "Signalement indisponible.");
    } finally {
      setReporting(false);
    }
  }
  return <ArchiveFrame title={personal ? "Mes stats" : "Profil public"} {...props}>
    {personal && <div className="archive-actions"><Link path="/mes-parties" navigate={props.navigate}>Mes parties</Link></div>}
    <Load loader={loader}>{(profile) => <>
      <ProfileContent profile={profile} navigate={props.navigate} />
      {canReport && <div className="archive-actions">
        <button type="button" disabled={reporting || reported} onClick={() => { void report(); }}>Signaler cet historique</button>
        {reportStatus && <span role="status">{reportStatus}</span>}
      </div>}
    </>}</Load>
  </ArchiveFrame>;
}

export function RecentMatches(props: RouteProps) {
  const [pages, setPages] = useState<Array<string | null>>([null]);
  const cursor = pages.at(-1) ?? null;
  const loader = useCallback((signal: AbortSignal) => readRecentMatches(cursor, signal), [cursor]);
  return <ArchiveFrame title="Mes parties" {...props}>
    <Load key={cursor} loader={loader}>{({ matches, next }) =>
      <section className="archive-card">{matches.length ? <ul className="archive-list">{matches.map((entry) =>
        <li key={entry.id}><Link navigate={props.navigate}
          path={(entry.status === "interrupted" ? tableSummaryPath : matchPath)(entry.id)}>{date.format(entry.date)}</Link>
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
  return <ArchiveFrame title="Classement" {...props}>
    <form className="archive-actions player-search" onSubmit={(event) => {
      event.preventDefault();
      setQuery(String(new FormData(event.currentTarget).get("name")).trim());
      setPages([""]);
    }}>
      <label>Rechercher un pseudo <input name="name" maxLength={15} pattern="[\p{L}0-9]+" /></label>
      <button type="submit">Rechercher</button>
    </form>
    <Load key={query + ":" + cursor} loader={loader}>{({ players, next }) => <section className="archive-card">
      {players.length ? <table className="directory-ranking" aria-label="Classement des joueurs">
        <colgroup><col /><col className="directory-matches" /><col className="directory-win-rate" /><col className="directory-rating" /></colgroup>
        <thead><tr><th scope="col">Nom</th><th scope="col">Parties</th>
          <th scope="col" title="Taux de victoire des manches">Manches gagnées</th><th scope="col">Indice RN</th></tr></thead>
        <tbody>{players.map((player) => <tr key={player.id}>
          <th scope="row"><span className="directory-player">
            <PlayerAvatar id={player.id} name={player.name} style={player.avatarStyle} photoId={player.avatarPhotoId} mini />
            <Link path={profilePath(player.id)} navigate={props.navigate}>{player.name}</Link>
          </span></th>
          <td>{number.format(player.matches)}</td><td>{percent.format(player.roundWinRate)}</td>
          <td><strong>{Math.round(player.rating)}</strong></td>
        </tr>)}</tbody>
      </table> : <p>Aucun joueur trouvé.</p>}
      {(pages.length > 1 || next) && <nav className="archive-actions" aria-label="Pages des joueurs">
        {pages.length > 1 && <button type="button" onClick={() => setPages(pages.slice(0, -1))}>Précédent</button>}
        {next && <button type="button" onClick={() => setPages([...pages, next])}>Suivant</button>}
      </nav>}
    </section>}</Load>
  </ArchiveFrame>;
}

export function RatingPodium({ navigate }: { navigate: Navigate }) {
  const [players, setPlayers] = useState<Awaited<ReturnType<typeof readPodium>>>([]);
  useEffect(() => {
    const controller = new AbortController();
    void readPodium(controller.signal).then(setPlayers, () => {});
    return () => controller.abort();
  }, []);
  if (!players.length) return null;
  return <section className="home-podium" aria-label="Podium RN">
    <ol>{players.map(({ id, name, avatarStyle, avatarPhotoId, rating }, index) =>
      <li key={id} data-place={index + 1}>
        <Link path={profilePath(id)} navigate={navigate}>
          <PlayerAvatar id={id} name={name} style={avatarStyle} photoId={avatarPhotoId} mini />
          <span className="podium-name" title={name}>{name}</span>
          <small>RN {Math.round(rating)}</small>
          <span className="podium-step"><span className="sr-only">Rang </span>{index + 1}</span>
        </Link>
      </li>,
    )}</ol>
  </section>;
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
