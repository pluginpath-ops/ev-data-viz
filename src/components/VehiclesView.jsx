import { useState } from 'react';

export default function VehiclesView({ vehicles, selectedVehicles, onToggleSelection, onAdd, onUpdate, onDelete, onViewRuns }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '', make: '', model: '', year: '',
        battery: '', range: '', power: ''
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingId) {
            onUpdate(editingId, formData);
            setEditingId(null);
        } else {
            onAdd(formData);
        }
        setFormData({ name: '', make: '', model: '', year: '', battery: '', range: '', power: '' });
        setShowForm(false);
    };

    const handleEdit = (vehicle, e) => {
        e.stopPropagation();
        setFormData({
            name: vehicle.name,
            make: vehicle.make || '',
            model: vehicle.model || '',
            year: vehicle.year || '',
            battery: vehicle.battery || '',
            range: vehicle.range || '',
            power: vehicle.power || ''
        });
        setEditingId(vehicle.id);
        setShowForm(true);
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingId(null);
        setFormData({ name: '', make: '', model: '', year: '', battery: '', range: '', power: '' });
    };

    const handleCardClick = (vehicle) => {
        onToggleSelection(vehicle.id);
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Vehicles</h2>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="btn btn-primary"
                >
                    {showForm ? 'Cancel' : '+ Add Vehicle'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} className="card mb-6">
                    <h3 className="text-lg font-bold mb-4">{editingId ? 'Edit Vehicle' : 'Add New Vehicle'}</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <input
                            placeholder="Display Name (e.g., Model 3 LR 2024)"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            className="border p-2 rounded col-span-2"
                            required
                        />
                        <input
                            placeholder="Make"
                            value={formData.make}
                            onChange={(e) => setFormData({...formData, make: e.target.value})}
                            className="border p-2 rounded"
                        />
                        <input
                            placeholder="Model"
                            value={formData.model}
                            onChange={(e) => setFormData({...formData, model: e.target.value})}
                            className="border p-2 rounded"
                        />
                        <input
                            placeholder="Year"
                            value={formData.year}
                            onChange={(e) => setFormData({...formData, year: e.target.value})}
                            className="border p-2 rounded"
                        />
                        <input
                            placeholder="Battery (kWh)"
                            value={formData.battery}
                            onChange={(e) => setFormData({...formData, battery: e.target.value})}
                            className="border p-2 rounded"
                        />
                        <input
                            placeholder="EPA Range (mi)"
                            value={formData.range}
                            onChange={(e) => setFormData({...formData, range: e.target.value})}
                            className="border p-2 rounded"
                        />
                        <input
                            placeholder="Peak Power (kW)"
                            value={formData.power}
                            onChange={(e) => setFormData({...formData, power: e.target.value})}
                            className="border p-2 rounded"
                        />
                    </div>
                    <div className="mt-4 flex gap-2">
                        <button type="submit" className="btn btn-primary">
                            {editingId ? 'Save Changes' : 'Add Vehicle'}
                        </button>
                        {editingId && (
                            <button type="button" onClick={handleCancel} className="btn btn-secondary">
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {vehicles.map(vehicle => {
                    const isSelected = selectedVehicles.includes(vehicle.id);
                    return (
                        <div
                            key={vehicle.id}
                            onClick={() => handleCardClick(vehicle)}
                            className="card hover:shadow-lg transition cursor-pointer relative"
                            style={{
                                borderWidth: '2px',
                                borderStyle: 'solid',
                                borderColor: isSelected ? 'var(--color-primary)' : 'transparent'
                            }}
                        >
                            {isSelected && (
                                <div
                                    className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white font-bold"
                                    style={{backgroundColor: 'var(--color-primary)'}}
                                >
                                    &#10003;
                                </div>
                            )}
                            <h3 className="text-xl font-bold mb-2">{vehicle.name}</h3>
                            <p className="text-gray-600 mb-4">{vehicle.make} {vehicle.model} {vehicle.year}</p>
                            <div className="text-sm text-gray-700 space-y-1 mb-4">
                                {vehicle.battery && <p>Battery: {vehicle.battery} kWh</p>}
                                {vehicle.range && <p>Range: {vehicle.range} mi</p>}
                                {vehicle.power && <p>Power: {vehicle.power} kW</p>}
                                <p className="font-semibold mt-2">Test Runs: {vehicle.runs?.length || 0}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onViewRuns(vehicle); }}
                                    className="btn btn-primary flex-1"
                                >
                                    View Runs
                                </button>
                                <button
                                    onClick={(e) => handleEdit(vehicle, e)}
                                    className="btn btn-edit"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDelete(vehicle.id); }}
                                    className="btn btn-danger"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {vehicles.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">No vehicles yet. Click "Add Vehicle" to get started!</p>
                </div>
            )}
        </div>
    );
}
