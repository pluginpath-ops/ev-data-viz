export default function SpecsView({ vehicles, selectedVehicleIds }) {
    const displayVehicles = selectedVehicleIds.length > 0
        ? vehicles.filter(v => selectedVehicleIds.includes(v.id))
        : vehicles;

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">
                Vehicle Specifications Comparison
                {selectedVehicleIds.length > 0 && ` (${selectedVehicleIds.length} Selected)`}
            </h2>

            {displayVehicles.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">
                        {vehicles.length === 0
                            ? 'No vehicles to compare. Add vehicles first!'
                            : 'No vehicles selected. Select vehicles from the Vehicles page to compare them here.'}
                    </p>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-x-auto" style={{backgroundColor: 'var(--color-card)'}}>
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left font-semibold">Specification</th>
                                {displayVehicles.map(v => (
                                    <th key={v.id} className="px-6 py-3 text-left font-semibold">{v.name}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            <tr>
                                <td className="px-6 py-4 font-medium">Make</td>
                                {displayVehicles.map(v => <td key={v.id} className="px-6 py-4">{v.make || '-'}</td>)}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 font-medium">Model</td>
                                {displayVehicles.map(v => <td key={v.id} className="px-6 py-4">{v.model || '-'}</td>)}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 font-medium">Year</td>
                                {displayVehicles.map(v => <td key={v.id} className="px-6 py-4">{v.year || '-'}</td>)}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 font-medium">Battery (kWh)</td>
                                {displayVehicles.map(v => <td key={v.id} className="px-6 py-4">{v.battery || '-'}</td>)}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 font-medium">EPA Range (mi)</td>
                                {displayVehicles.map(v => <td key={v.id} className="px-6 py-4">{v.range || '-'}</td>)}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 font-medium">Peak Power (kW)</td>
                                {displayVehicles.map(v => <td key={v.id} className="px-6 py-4">{v.power || '-'}</td>)}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 font-medium">Test Runs</td>
                                {displayVehicles.map(v => <td key={v.id} className="px-6 py-4">{v.runs?.length || 0}</td>)}
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
