import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import TypographyKnobs from './TypographyKnobs';
import ImageMaintenance from './ImageMaintenance';

/**
 * Admin sub-tab: site-wide interface settings.
 *
 * Currently the site header image (a global setting stored via update_site_setting).
 * Per-user preferences (theme, units) are intentionally NOT here — they live in the
 * top bar because they're per-browser, not site-wide.
 */
export default function InterfaceSettings() {
    const { headerImageUrl, uploadHeaderImage } = useAppContext();
    const [uploading, setUploading] = useState(false);

    async function handleUpload(file) {
        if (!file) return;
        setUploading(true);
        try {
            await uploadHeaderImage(file);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="card p-5">
                <h3 className="section-title">Site header image</h3>
                <p className="text-sm text-secondary mt-0.5 mb-3">
                    Background image shown behind the title on the home page. Applies site-wide for
                    all visitors.
                </p>

                {headerImageUrl ? (
                    <div
                        className="w-full h-32 rounded-lg border border-[var(--color-border)] mb-3"
                        style={{ backgroundImage: `url(${headerImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    />
                ) : (
                    <div className="w-full h-32 rounded-lg border border-dashed border-[var(--color-border-strong)] flex items-center justify-center text-sm text-faint mb-3">
                        No header image set
                    </div>
                )}

                <label className="btn btn-secondary text-sm cursor-pointer inline-flex">
                    {uploading ? 'Uploading…' : headerImageUrl ? '📷 Replace image' : '📷 Upload image'}
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => { handleUpload(e.target.files[0]); e.target.value = ''; }}
                    />
                </label>
            </div>

            <ImageMaintenance />

            <TypographyKnobs />

            <div className="card p-5">
                <h3 className="section-title">Personal preferences</h3>
                <p className="text-sm text-secondary mt-0.5">
                    Theme and unit system (imperial/metric) are per-browser preferences — set them
                    from the toggles in the top bar. They aren't site-wide settings, so they live
                    there rather than here.
                </p>
            </div>
        </div>
    );
}
