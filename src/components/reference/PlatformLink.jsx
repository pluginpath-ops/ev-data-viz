import { useNavigation } from '../../context/NavigationContext';
import { platformHref } from '../../utils/platforms';

/**
 * A link to a platform's page (#354). A real href, so a new tab works; a plain
 * click navigates in place when the app can.
 */
export default function PlatformLink({ platform, className = '', children, title }) {
    const { openPlatform } = useNavigation();
    if (!platform) return children ?? null;
    return (
        <a
            href={platformHref(platform.id)}
            className={className}
            title={title}
            onClick={(e) => {
                e.stopPropagation();
                if (!openPlatform || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                openPlatform(platform.id);
            }}
        >
            {children ?? platform.name}
        </a>
    );
}
