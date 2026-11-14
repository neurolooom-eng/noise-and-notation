import RefreshButton from './RefreshButton';

export const ORG_NAME = 'Noise & Notation';
export const ORG_TAGLINE = 'A Book of Mindless Misc';
export const ORG_URL = 'https://noiseandnotation.com/';

const LOGO_SRC = `${import.meta.env.BASE_URL}brand/noise-and-notation-logo.webp`;

/** Chalkboard band matching noiseandnotation.com: logo, tagline, refresh. */
export default function BrandHeader() {
  return (
    <header className="board">
      <div className="board-inner">
        <a className="brand" href={ORG_URL} target="_blank" rel="noreferrer" title={`${ORG_NAME} — main site`}>
          <img src={LOGO_SRC} alt={ORG_NAME} width={632} height={169} />
          <span className="tagline">{ORG_TAGLINE}</span>
        </a>
        <RefreshButton />
      </div>
    </header>
  );
}

export function BrandFooter() {
  return (
    <footer className="site-footer">
      <span>
        © {new Date().getFullYear()} {ORG_NAME}
      </span>
      <span aria-hidden="true">·</span>
      <a href={ORG_URL} target="_blank" rel="noreferrer">
        noiseandnotation.com
      </a>
    </footer>
  );
}
