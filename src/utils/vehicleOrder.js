/**
 * The curated vehicle order: Vehicles & Specs' default sort, the order a
 * curator drags cards into (`vehicles.sort_order`). Today it stands in for
 * sales and influence, so anything that needs "the top few" of a set reads it
 * here rather than inventing a ranking.
 *
 * Vehicles with an order come first, lowest first; the rest follow, newest
 * first. `orderOf` lets Vehicles & Specs read an in-flight drag before it is
 * saved.
 *
 * Pure module.
 */
export function compareCuratedOrder(a, b, orderOf = (v) => v.sort_order) {
    const aOrder = orderOf(a);
    const bOrder = orderOf(b);
    const aN = aOrder == null, bN = bOrder == null;
    if (!aN && !bN) return aOrder - bOrder;
    if (!aN) return -1;
    if (!bN) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
}
