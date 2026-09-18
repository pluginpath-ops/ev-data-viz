import { useEffect, useState } from 'react';
import { PHOTO_ASPECT } from '../utils/cardBand';

/**
 * A stored photo's real aspect (width / height), read from the image itself.
 *
 * Not every stored photo is the 16:9 the crop step produces — some predate it
 * or came in through import (#340 found a 3:2 and a 1.42:1 on the first page).
 * The card draws those correctly, because `cover` works from the image's own
 * shape. A preview that assumed 16:9 did not: it cropped the frame to 16:9 and
 * sized the band window for a photo that was not there.
 *
 * Returns PHOTO_ASPECT until the image has loaded, and for a photo that fails
 * to, which is right for everything the crop step has produced and wrong only
 * for the moment it takes the browser to answer from its cache.
 *
 * The answer is keyed by URL rather than reset when it changes, so a new photo
 * never briefly shows the old one's shape — and nothing sets state
 * synchronously in the effect.
 */
export function usePhotoAspect(url) {
    const [measured, setMeasured] = useState({ url: null, aspect: null });

    useEffect(() => {
        if (!url) return;
        let live = true;
        const img = new Image();
        img.onload = () => {
            if (live && img.naturalWidth && img.naturalHeight) {
                setMeasured({ url, aspect: img.naturalWidth / img.naturalHeight });
            }
        };
        img.src = url;
        return () => { live = false; };
    }, [url]);

    return measured.url === url && measured.aspect ? measured.aspect : PHOTO_ASPECT;
}
