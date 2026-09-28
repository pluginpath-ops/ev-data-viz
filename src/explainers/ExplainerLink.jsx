import { useNavigation } from '../context/NavigationContext';

/** Where an explainer lives, as a query string: a real href. */
export const explainerHref = (slug) => `?tab=reference&sub=explainers&topic=${encodeURIComponent(slug)}`;

/**
 * "Learn more →" to an explainer, by slug. One of the two things EVBench may
 * import from src/explainers (eslint.config.js). A real href, so a new tab
 * works; a plain click navigates in place, like PlatformLink.
 */
export default function ExplainerLink({ topic, className = 'explainer-link', children, title }) {
    const { openExplainer } = useNavigation();
    return (
        <a
            href={explainerHref(topic)}
            className={className}
            title={title}
            onClick={(e) => {
                e.stopPropagation();
                if (!openExplainer || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                openExplainer(topic);
            }}
        >
            {children ?? 'Learn more →'}
        </a>
    );
}
