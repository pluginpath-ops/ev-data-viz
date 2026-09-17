import ColumnPicker from '../../tables/ColumnPicker';
import { GUIDE_COLUMNS, DEFAULT_COLUMNS } from '../../../utils/feGuideBrowse';

/**
 * Which columns the guide table shows, and in what order (#235, phase 5b).
 *
 * The guide holds 30-odd fields per configuration and a table showing all of
 * them is unreadable, but which ten matter depends entirely on the question —
 * someone comparing label methods wants the adjustment factor and signature,
 * someone shopping wants range and MPGe.
 *
 * The picker itself is shared with the vehicle table (#315); see
 * tables/ColumnPicker. Configuration is this table's fixed column.
 */
export default function GuideColumnPicker({ visible, onChange }) {
    return (
        <ColumnPicker
            columns={GUIDE_COLUMNS}
            visible={visible}
            defaults={DEFAULT_COLUMNS}
            fixedKey="carline"
            onChange={onChange}
        />
    );
}
