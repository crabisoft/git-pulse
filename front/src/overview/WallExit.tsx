import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { WALL_PARAM, withoutWall } from '../wall';

/**
 * The way back off a wall screen.
 *
 * Everything else has been taken away, so this is the one control that has to
 * remain — leaving by hand-editing the address is not a way out anybody finds.
 * Held at nearly nothing until a pointer moves anywhere over the page: whoever
 * walks up to the monitor reveals it without meaning to, and from three metres
 * away it is not there at all.
 */
export function WallExit() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const back = withoutWall(searchParams);

  return (
    <Link className="wall-exit" to={`${pathname}${back ? `?${back}` : ''}`}>
      {t('overview.wall.exit')}
    </Link>
  );
}

/**
 * The way onto one, from the page it is about.
 *
 * The address carries the scope already, so turning the screen in the corner
 * into a wall is a link and not a setting: open the page with the filters you
 * want, press this, leave the browser there.
 */
export function WallEnter() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const params = new URLSearchParams(searchParams);
  params.set(WALL_PARAM, '');

  return (
    <Link className="btn wall-enter" to={`${pathname}?${params.toString()}`}>
      {t('overview.wall.enter')}
    </Link>
  );
}
