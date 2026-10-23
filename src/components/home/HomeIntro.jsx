/**
 * What EVBench is, in two sentences, at the top of Home (#448).
 *
 * Shown above whatever is featured, and on its own when nothing is: it is the
 * first thing a new visitor reads, so it makes the claim the featured
 * comparison then demonstrates. The words are the owner's; edit them here.
 */
export default function HomeIntro() {
    return (
        <section className="home-intro" aria-labelledby="home-intro-title">
            <h2 id="home-intro-title" className="page-title">Real EVs, tested, and presented on a level field</h2>
            <p className="text-secondary home-intro-body">
                EVBench aggregates data from a variety of sources and applies mathematical modeling to provide the most
                realistic predictions on range, efficiency, and charging performance. See how EVs will perform for{' '}
                <em>your</em> use case: adjust for speed, altitude and temperature, and compare any class of car, from
                commuters to trucks, on the same footing.
            </p>
        </section>
    );
}
