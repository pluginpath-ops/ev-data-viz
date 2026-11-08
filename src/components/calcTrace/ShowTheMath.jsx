import CollapsibleSection from '../CollapsibleSection';

/**
 * "Show the math" — a closed section that, opened, runs one pass of the page's
 * own calculation with a calculation trace on (utils/calcTrace.js).
 *
 * Closed, it costs one small render and nothing else: `Body`, and everything
 * it works out (the options, the pass), mounts only when the section opens,
 * since CollapsibleSection unmounts its children. So a caller hands its raw
 * props through, and its Body builds from them.
 *
 * Props:
 *   Body  {Component}  the open contents, given every other prop
 */
export default function ShowTheMath({ Body, ...props }) {
    return (
        <div className="card mt-4">
            <CollapsibleSection title="Show the math" subtitle="one pass, worked from the live code">
                <Body {...props} />
            </CollapsibleSection>
        </div>
    );
}
