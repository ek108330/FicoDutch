import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowLeftRight, Crosshair, Crown, Gift, ShieldX,
  Swords, Timer, TriangleAlert, Trophy } from "lucide-react";
import type { Award, AwardId, MatchPlayer, Profile, SavedMatch } from "../../../shared/statistics";
import { matchPath, profilePath, readDemoBots, readMatch, readPlayers, readPodium, readProfile, readRecentMatches,
  readTableSummary, tableSummaryPath, type DirectorySort } from "../network/accountApi";
import PlayerAvatar from "./PlayerAvatar";
import FriendProfileActions from "./FriendProfileActions";
import RatingBadge from "./RatingBadge";
import RatingChange from "./RatingChange";
import { describeCardFace, suits } from "./cardLabels";
import type { CardRank } from "../game/cards";

type Navigate = (path: string) => void;
type RouteProps = { navigate: Navigate; backToTable?: boolean; leaveTable?: () => void };
type Loader<T> = (signal: AbortSignal) => Promise<T>;
const date = new Intl.DateTimeFormat("fr", { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("fr", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("fr", { style: "percent", maximumFractionDigits: 0 });
const weeklyRatingDelta = new Intl.NumberFormat("fr", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
const seconds = new Intl.NumberFormat("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const individual = [
  ["shuriken", "Le défausseur", Swords], ["luckyLuke", "Lucky Lucke", Timer], ["boulet", "Le boulet", TriangleAlert],
  ["cible", "Cible dans le dos", Crosshair], ["roisNoirs", "Mr. Roinoir", Crown],
  ["distributeur", "Le distributeur", Gift],
] as const;
const interactions = [
  ["victime", "Victime préférée", Crosshair], ["rivalite", "Rivalité principale", Swords],
  ["pire", "Pire échange", ArrowLeftRight], ["bourreau", "Bourreau des Dutch", ShieldX],
] as const;

function Link({ path, navigate, children }: { path: string; navigate: Navigate; children: ReactNode }) {
  return <a href={path} onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  }}>{children}</a>;
}

function ArchiveFrame({ title, children, navigate, backToTable, leaveTable, className }: RouteProps & {
  title: string; children: ReactNode; className?: string;
}) {
  return <main className={className ? `archive-screen ${className}` : "archive-screen"}>
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
    loader(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setError(undefined);
      setData(next);
    }, (caught: Error) => {
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
function awardValue(id: AwardId, { value, extra }: Award, shared = false) {
  switch (id) {
    case "luckyLuke": return `en ${seconds.format(value / 1_000)} s`;
    case "boulet": return `avec ${plural(value, "erreur")}${extra === undefined ? "" : ` pour ${plural(extra, "point")}`}`;
    case "cible": return `${shared ? "ont chacun subi" : "avec"} ${plural(value, "action")} de ${plural(extra ?? 0, "adversaire")}`;
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
  const { value, exchange, players } = award;
  const names = players.map((key) => <PlayerName key={key} player={roster.get(key)} navigate={navigate} />);
  const [a, b] = names;
  switch (id) {
    case "victime": return <>{a} a ciblé {b} dans {plural(value, "échange")}.</>;
    case "rivalite": return <>{a} et {b} ont échangé {plural(value, "fois", "fois")}.</>;
    case "pire": return exchange
      ? <><PlayerName player={roster.get(exchange.opponentId)} navigate={navigate} />
        {" a donné "}{exchangeCard(exchange.received)} à {a} contre {exchangeCard(exchange.given)}.</>
      : <>{a} a pris {plural(value, "point")} de plus en un échange.</>;
    case "bourreau": return <>{names.map((name, index) =>
      <Fragment key={players[index]}>{index > 0 && " & "}{name}</Fragment>)}
      {names.length === 1 ? " a" : " ont"} fait échouer {plural(value, "Dutch", "Dutch")}.</>;
    default: return null;
  }
}

function MatchRanking({ match, navigate }: { match: SavedMatch; navigate: Navigate }) {
  const ranked = match.players.filter(({ rank }) => rank !== undefined).sort((a, b) => a.rank! - b.rank!);
  const movements = new Map(match.ratingMovements?.map((entry) => [entry.accountId, entry]));
  const rows = ranked.map((player) => {
    const movement = player.accountId ? movements.get(player.accountId) : undefined;
    if (player.accountId) movements.delete(player.accountId);
    return { ...player, delta: movement?.delta };
  });
  const unranked = [...movements.values()].sort((a, b) => b.delta - a.delta);
  const official = ranked.length > 0;
  const title = official ? "Classement officiel" : "Variations de l’indice RN";
  if (!official && !unranked.length) return null;

  return <section className="archive-card archive-ranking" aria-labelledby="archive-ranking-title">
    <h2 id="archive-ranking-title">{title}</h2>
    {official && match.status === "interrupted" && <p>Dernière partie terminée</p>}
    <table aria-labelledby="archive-ranking-title">
      <thead><tr>
        {official && <th scope="col">Rang</th>}
        <th scope="col">Joueur</th><th scope="col" className="archive-ranking-rn">RN</th>
        {official && <th scope="col">Total</th>}
      </tr></thead>
      <tbody>
        {rows.map(({ delta, ...player }) => <tr key={player.id}>
          <td>{player.rank}</td><th scope="row"><PlayerName player={player} navigate={navigate} /></th>
          <td className="archive-ranking-rn">{delta === undefined ? "—" : <RatingChange delta={delta} />}</td>
          <td>{player.total}</td>
        </tr>)}
        {unranked.map(({ accountId, name, delta }) => <tr key={accountId}>
          {official && <td>—</td>}
          <th scope="row"><Link path={profilePath(accountId)} navigate={navigate}>{name}</Link></th>
          <td className="archive-ranking-rn"><RatingChange delta={delta} /></td>
          {official && <td>—</td>}
        </tr>)}
      </tbody>
    </table>
  </section>;
}

function MatchContent({ match, navigate }: { match: SavedMatch; navigate: Navigate }) {
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
    <MatchRanking match={match} navigate={navigate} />
    <section aria-labelledby="individual-title">
      <h2 id="individual-title">Récompenses individuelles</h2>
      <div className="archive-awards">{individual.map(([id, title, Icon]) => {
        const awards = match.awards[id];
        return <article className="archive-card" key={id}>
          <h3><Icon size={16} aria-hidden="true" />{title}</h3>
          {awards?.length && (id === "roisNoirs" || id === "cible") ? <p>
            <strong>{awards.map((award, index) => <Fragment key={award.players[0]}>
              {index > 0 && " & "}<PlayerName player={roster.get(award.players[0])} navigate={navigate} />
            </Fragment>)}</strong>{" "}{awardValue(id, awards[0], awards.length > 1)}.
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
        {interactions.map(([id, title, Icon]) => {
          const awards = match.awards[id] ?? [];
          const entries = id === "bourreau" && awards.length > 1
            ? [{ ...awards[0], players: awards.flatMap(({ players }) => players) }]
            : awards;
          return <div className="archive-card" key={id}>
            <dt><Icon size={16} aria-hidden="true" />{title}</dt>
            {entries.length ? entries.map((award) => <dd key={award.players.join(":")}>
              <Interaction id={id} award={award} roster={roster} navigate={navigate} />
            </dd>) : <dd className="archive-muted">Non attribuée</dd>}
          </div>;
        })}
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
  const step = [10, 20].find((interval) => best - lowest <= 4 * interval) ?? 25;
  const minSpan = 40;
  const padding = Math.max(1, (minSpan - (best - lowest)) / 2);
  const floor = Math.max(0, Math.min(100 - minSpan, Math.floor((lowest - padding) / step) * step));
  const ceiling = Math.min(100, Math.max(floor + minSpan, Math.ceil((best + padding) / step) * step));
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

function outcomeRate(successes: number, total: number) {
  return total ? percent.format(successes / total) : "—";
}

function RivalResults({ wins, losses }: Pick<Profile["rivals"][number], "wins" | "losses">) {
  const victories = plural(wins, "victoire");
  const defeats = plural(losses, "défaite");
  return <div className="rival-results">
    <span className="rival-wins" role="img" aria-label={victories} title={victories}>
      <Trophy size={14} aria-hidden="true" />{number.format(wins)}
    </span>
    <span className="rival-losses" role="img" aria-label={defeats} title={defeats}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2.1 0 4.7-1.2 6.4-2.8a1 1 0 0 1 1.2 0C14.3 3.8 16.9 5 19 5a1 1 0 0 1 1 1Z" />
        <path d="m13 6-4 6 5 1-3 5" />
      </svg>{number.format(losses)}
    </span>
  </div>;
}

function ProfileContent({ profile, navigate, viewerId }: { profile: Profile; navigate: Navigate; viewerId?: string }) {
  const rating = Math.round(profile.rating);
  const roundWinRate = outcomeRate(profile.roundWins, profile.rounds);
  const totals = [
    { title: "Parties", played: profile.matches, wins: profile.victories, rate: outcomeRate(profile.victories, profile.finished),
      rateTitle: "Sur les parties terminées" },
    { title: "Manches", played: profile.rounds, wins: profile.roundWins, rate: roundWinRate },
    { title: "Dutch", played: profile.dutch, wins: profile.dutchWon, rate: outcomeRate(profile.dutchWon, profile.dutch) },
  ];
  const details: [string, string | number][] = [
    ["Score moyen par manche", profile.rounds ? number.format(profile.scoreSum / profile.rounds) : "—"],
    ["Réactions réussies", profile.reactions], ["Pénalités de réaction", profile.penalties], ["10 et Valets utilisés", profile.exchanges],
  ];
  const groups = [
    { title: "Rivaux réguliers", rivals: profile.rivals.filter(({ played }) => played >= 3).slice(0, 3) },
    { title: "Joueurs dominés", rivals: profile.rivals.filter(({ played, wins, losses }) => played >= 3 && wins > losses).slice(0, 3),
      rate: "wins" as const },
    { title: "Bêtes noires", rivals: profile.rivals.filter(({ played, wins, losses }) => played >= 3 && losses > wins).slice(0, 3),
      rate: "losses" as const },
  ];
  return <>
    <div className="profile-overview">
      <div className="profile-identity">
        <PlayerAvatar id={profile.id} name={profile.name} style={profile.avatarStyle} photoId={profile.avatarPhotoId} isBot={profile.demoBot} />
        <h2>{profile.name}</h2>
      </div>
      <dl className="archive-card profile-headline" aria-label="Indicateurs du profil">
        <div><dt>Indice RN</dt><dd><RatingBadge rating={rating} /><small>{ratingLevel(rating)}</small></dd></div>
        <div><dt>Manches gagnées</dt><dd>{roundWinRate}</dd></div>
      </dl>
    </div>
    <FriendProfileActions key={viewerId} id={viewerId && viewerId !== profile.id && !profile.demoBot ? profile.id : undefined}>
    {profile.demoBot && <p className="archive-muted">Bot de démonstration · historique initial simulé</p>}
    <div className="profile-stat-groups">
      {totals.map(({ title, played, wins, rate, rateTitle }) => <section key={title} className="archive-card profile-stat-group"
        aria-label={title}>
        <h2>{title} <strong>{number.format(played)}</strong></h2>
        <dl>
          <div className="profile-stat-count"><dt>{title === "Dutch" ? "Dont réussis" : "Dont gagnées"}</dt><dd>{number.format(wins)}</dd></div>
          <div className="profile-stat-count"><dt title={rateTitle}>{title === "Dutch" ? "Réussite" : "Victoires"}</dt><dd>{rate}</dd></div>
        </dl>
      </section>)}
    </div>
    <dl className="archive-card profile-numbers">{details.map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <section className="archive-card">
      <h2>Évolution de l’indice RN</h2>
      <RatingHistory ratings={profile.ratings} />
    </section>
    {groups.map(({ title, rivals, rate }) => <section key={title} className="archive-card profile-rival-group" aria-label={title}>
      <h2>{title}</h2>
      {rivals.length ? <ul className="archive-list profile-rivals">{rivals.map((rival) => <li key={rival.id}>
        <Link path={profilePath(rival.id)} navigate={navigate}>{rival.name}</Link>
        <span className="profile-rival-rating"><RatingBadge className="table-rn" rating={rival.rating} /></span>
        <span>{plural(rival.played, "manche")}</span>
        <div className="rival-record">
          <RivalResults wins={rival.wins} losses={rival.losses} />
          {rate && <span className={`rival-rate rival-${rate}`}>
            {outcomeRate(rival[rate], rival.played)} de {rate === "wins" ? "victoires" : "défaites"}
          </span>}
        </div>
      </li>)}</ul> : <p className="archive-muted">Aucun résultat à afficher.</p>}
    </section>)}
    </FriendProfileActions>
  </>;
}

export function PublicProfile({ id, personal, viewerId, ...props }: RouteProps & { id: string; personal?: boolean; viewerId?: string }) {
  const [loader] = useState(() => (signal: AbortSignal) => readProfile(id, signal));
  return <ArchiveFrame title={personal ? "Mes stats" : "Profil public"} {...props}>
    {personal && <div className="archive-actions"><Link path="/mes-parties" navigate={props.navigate}>Mes parties</Link></div>}
    <Load loader={loader}>{(profile) => <ProfileContent profile={profile} navigate={props.navigate} viewerId={viewerId} />}</Load>
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
  const [sort, setSort] = useState<DirectorySort>({ column: "rating", direction: "desc" });
  const cursor = pages.at(-1) ?? "";
  const requestKey = `${query}:${sort.column}:${sort.direction}:${cursor}`;
  const loader = useCallback(async (signal: AbortSignal) => ({
    ...await readPlayers(query, cursor, sort, signal), key: requestKey,
  }), [query, cursor, sort, requestKey]);
  const columns = [
    ["position", "Rang", "Position au classement RN"], ["name", "Nom", "Pseudo du joueur"],
    ["rounds", "Manches", "Nombre de manches jouées"],
    ["wins", "Victoires", "Taux de victoire des manches"], ["rating", "RN", "Indice RN"],
    ["week", "7j", "Évolution du RN sur les sept derniers jours"],
  ] as const;
  return <ArchiveFrame title="Classement" className="directory-screen" {...props}>
    <input className="player-search" type="search" placeholder="Rechercher un joueur" aria-label="Rechercher un joueur"
      autoComplete="off" maxLength={15} value={query} onChange={(event) => {
        setQuery(event.target.value.normalize("NFC").replace(/[^\p{L}0-9]/gu, ""));
        setPages([""]);
      }} />
    <Load loader={loader}>{({ players, next, key }) => <section className="archive-card directory-card" aria-busy={key !== requestKey}>
      {players.length ? <table className="directory-ranking" aria-label="Classement des joueurs">
        <colgroup><col className="directory-rank" /><col /><col className="directory-rounds" /><col className="directory-win-rate" />
          <col className="directory-rating" /><col className="directory-rating-week" /></colgroup>
        <thead><tr>{columns.map(([column, label, title]) => {
          const active = sort.column === column;
          return <th key={column} scope="col" aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : undefined}>
            <button type="button" title={title} onClick={() => {
              const direction = active ? sort.direction === "desc" ? "asc" : "desc" :
                column === "name" || column === "position" ? "asc" : "desc";
              setSort({ column, direction });
              setPages([""]);
            }}>
              {label}{active && <span className="directory-sort-indicator" aria-hidden="true" />}
            </button>
          </th>;
        })}</tr></thead>
        <tbody>{players.map((player) => {
          const weekStart = player.ratingWeekStart;
          const change = weekStart == null ? null : player.rating - weekStart;
          const place = player.position != null && player.position <= 3 ? player.position : undefined;
          return <tr key={player.id} data-place={place}>
            <td><span className="directory-position">{player.position ?? "-"}</span></td>
            <th scope="row"><span className="directory-player">
              <PlayerAvatar id={player.id} name={player.name} style={player.avatarStyle} photoId={player.avatarPhotoId} isBot={player.demoBot} mini />
              <Link path={profilePath(player.id)} navigate={props.navigate}>{player.name}</Link>
            </span></th>
            <td>{number.format(player.rounds)}</td><td>{percent.format(player.roundWinRate)}</td>
            <td><RatingBadge rating={player.rating} /></td>
            <td data-change={change != null && Math.abs(change) >= 0.5 ? Math.sign(change) : undefined}
              title={weekStart == null ? "Aucune manche classée ces sept derniers jours" :
                `RN au début de la période · ${Math.round(weekStart)}`}>
              {change == null ? "—" : weeklyRatingDelta.format(change)}
            </td>
          </tr>;
        })}</tbody>
      </table> : <p>Aucun joueur trouvé.</p>}
      {key === requestKey && (pages.length > 1 || next) && <nav className="archive-actions" aria-label="Pages des joueurs">
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
    <ol>{players.map(({ id, name, avatarStyle, avatarPhotoId, rating, demoBot }, index) =>
      <li key={id} data-place={index + 1}>
        <Link path={profilePath(id)} navigate={navigate}>
          <PlayerAvatar id={id} name={name} style={avatarStyle} photoId={avatarPhotoId} isBot={demoBot} mini />
          <span className="podium-name" title={name}>{name}</span>
          <RatingBadge className="podium-rating" rating={rating} showLabel />
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
