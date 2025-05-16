
// Globals
let activeMode = null;
let selectedFeature = null; // Renamed from activeFeature for clarity
let drawInteraction = null; // Renamed from draw
let selectInteraction = null;
let modifyInteraction = null;
let scenarioLocked = false; // Tracks edit lock state
let routesAreValid = false; // Track if routes are current
let routesExist = false; // Track if any routes are loaded

const scenarioId = {{ scenario.id }};
const buildingId = {{ building.id }};
const csrfToken = getCsrfToken(); // Get CSRF token once

// --- Layer Definitions ---
const geoJsonFormat = new ol.format.GeoJSON();

const drawSource = new ol.source.Vector({ wrapX: false });
const drawnItemsLayer = new ol.layer.Vector({
    source: drawSource,
    style: new ol.style.Style({ // Default style for drawing items before save
        image: new ol.style.Circle({
            radius: 7,
            fill: new ol.style.Fill({ color: 'rgba(255, 255, 255, 0.2)' }),
            stroke: new ol.style.Stroke({ color: '#ffcc33', width: 2 })
        }),
        stroke: new ol.style.Stroke({ color: '#ffcc33', width: 2 })
    })
});

const levelSource = new ol.source.Vector({
    format: geoJsonFormat,
    url: `{% url 'simulator:api_geojson'%}?model=level&fk=building&fk_id=${buildingId}`
});
const levelsLayer = new ol.layer.Vector({
    source: levelSource,
    style: new ol.style.Style({
        'stroke-color': 'black', 'stroke-width': 4, 'fill-color': 'rgba(10,10,10,0.3)'
    })
});

const detailSource = new ol.source.Vector({
    format: geoJsonFormat,
    url: `{% url 'simulator:api_geojson'%}?model=detail&fk=level&fk_id=1` // Assuming level 1 for now, adjust if dynamic
});
const detailsLayer = new ol.layer.Vector({
    source: detailSource,
    style: new ol.style.Style({ 'stroke-color': 'black', 'stroke-width': 1 })
});

const evacGroupsSource = new ol.source.Vector({
    format: geoJsonFormat,
    url: `{% url 'simulator:api_geojson'%}?model=evac_group&fk=scenario&fk_id=${scenarioId}`
});
const evacGroupsLayer = new ol.layer.Vector({
    source: evacGroupsSource,
    style: function(feature) {
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: Math.max(5, parseInt(feature.get('capacity')) / 2 || 5), // Adjust radius based on capacity
                fill: new ol.style.Fill({ color: 'rgb(51, 131, 250)' }),
                stroke: new ol.style.Stroke({ color: 'rgb(14, 37, 71)', width: 1.5 })
            })
        });
    }
});

const exitsSource = new ol.source.Vector({
    format: geoJsonFormat,
    url: `{% url 'simulator:api_geojson'%}?model=exit&fk=scenario&fk_id=${scenarioId}`
});
const exitsLayer = new ol.layer.Vector({
    source: exitsSource,
    style: new ol.style.Style({
        image: new ol.style.RegularShape({
            fill: new ol.style.Fill({color: 'orange'}),
            stroke: new ol.style.Stroke({color: 'black', width: 1}),
            points: 4, radius: 10, angle: Math.PI / 4
        })
    })
});

const barriersSource = new ol.source.Vector({
    format: geoJsonFormat,
    url: `{% url 'simulator:api_geojson'%}?model=barrier&fk=scenario&fk_id=${scenarioId}`
});
const barriersLayer = new ol.layer.Vector({
    source: barriersSource,
    style: new ol.style.Style({ 'stroke-width': 3, 'stroke-color':'red' })
});

// NEW: EvacRoutes Layer
const evacRoutesSource = new ol.source.Vector({
    format: geoJsonFormat,
    url: `{% url 'simulator:api_geojson'%}?model=evac_route&fk=scenario&fk_id=${scenarioId}` // NOTE: Ensure this model is supported by api_geojson
});
const evacRoutesLayer = new ol.layer.Vector({
    source: evacRoutesSource,
    style: function(feature) {
        // Assuming 'valid' property is set on the GeoJSON features by the server
        // or we update it client-side after invalidation
        const isValid = feature.get('valid') !== undefined ? feature.get('valid') : true; // Default to true if not set
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: isValid ? 'blue' : 'grey', // Blue for valid, grey for invalid
                width: isValid ? 3 : 2
            })
        });
    }
});


const mainMap = new ol.Map({
    target: "map",
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM() }),
      levelsLayer, detailsLayer, evacGroupsLayer, exitsLayer, barriersLayer, evacRoutesLayer, drawnItemsLayer
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([{{ center.x }}, {{ center.y }}]), // Ensure center is LonLat
      zoom: 18
    })
});

// --- Initialization ---
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('scenarioName').addEventListener('change', updateScenarioName);
    
    document.querySelectorAll('.mode-button').forEach(button => {
        button.addEventListener('click', function() { setMode(this.dataset.mode); });
    });

    document.addEventListener('keydown', function(event) {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return; // Ignore keydown in inputs
        switch(event.key.toLowerCase()) {
            case 'i': if (!scenarioLocked) setMode('incident'); break;
            case 'e': if (!scenarioLocked) setMode('exit'); break;
            case 'b': if (!scenarioLocked) setMode('barrier'); break;
            case 'm': if (!scenarioLocked) setMode('edit'); break;
            case 'escape': cancelInteractions(); break;
            case 'delete': if (!scenarioLocked && selectedFeature) deleteSelectedFeature(); break;
        }
    });

    initializeInteractions();
    loadInitialData();
    checkSimulationStatus(); // For edit lock and results button
    updateActionButtonsVisibility(); // Initial check for buttons
});

function loadInitialData() {
    // Refresh sources to get latest data
    [evacGroupsSource, exitsSource, barriersSource, evacRoutesSource].forEach(source => {
        source.on('featuresloadend', () => {
            // Set db_id and featureType for features loaded from persistent layers
            source.getFeatures().forEach(feature => {
                const properties = feature.getProperties();
                if (properties.id && !feature.get('db_id')) { // Check if db_id not already set
                    feature.set('db_id', properties.id);
                    feature.setId(properties.id); // Important for OpenLayers feature management
                }
                if (!feature.get('featureType')) {
                    if (source === evacGroupsSource) feature.set('featureType', 'evac_group');
                    else if (source === exitsSource) feature.set('featureType', 'exit');
                    else if (source === barriersSource) feature.set('featureType', 'barrier');
                    else if (source === evacRoutesSource) {
                        feature.set('featureType', 'evac_route');
                        // Assuming GeoJSON from server has an 'valid' property
                        // If not, you might need an API call to check route validity
                        if (feature.get('valid') === undefined) feature.set('valid', true); // Default
                    }
                }
            });
            updateActionButtonsVisibility(); // Update buttons after any layer loads
            checkRoutesState(); // Check if routes exist and their validity
        });
        source.refresh();
    });
}


// --- UI Interaction Functions ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.sidebar-toggle');
    sidebar.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
    toggle.querySelector('i').classList.toggle('bi-chevron-left');
    toggle.querySelector('i').classList.toggle('bi-chevron-right');
    setTimeout(() => mainMap.updateSize(), 300); // Update map size after transition
}

function setMode(mode) {
    if (scenarioLocked) {
        showStatus("Editing is locked as simulation results exist. Disable lock to edit.", "info");
        return;
    }
    
    cancelInteractions(false); // Cancel previous interactions but don't clear selection if it's an edit mode switch
    activeMode = mode;

    document.querySelectorAll('.mode-button').forEach(btn => btn.classList.remove('active'));
    const activeButton = document.querySelector(`.mode-button[data-mode="${mode}"]`);
    if (activeButton) activeButton.classList.add('active');

    const capacityContainer = document.getElementById('capacity-container');
    capacityContainer.style.display = 'none'; // Hide by default
    document.getElementById('properties-panel').style.display = 'none';


    switch(mode) {
        case 'incident':
            addDrawInteraction('Point', 'evac_group');
            capacityContainer.style.display = 'block'; // Show capacity input for new incidents
            document.getElementById('capacity').value = 1; // Reset
            break;
        case 'exit':
            addDrawInteraction('Point', 'exit');
            break;
        case 'barrier':
            addDrawInteraction('LineString', 'barrier');
            break;
        case 'edit':
            mainMap.addInteraction(selectInteraction);
            mainMap.addInteraction(modifyInteraction);
            // Properties panel will be shown on selection
            break;
        default: // No mode or deselect
             activeMode = null; // Clear active mode
             document.querySelectorAll('.mode-button').forEach(btn => btn.classList.remove('active'));
             break;
    }
}

function cancelInteractions(clearSelection = true) {
    if (drawInteraction) mainMap.removeInteraction(drawInteraction);
    drawInteraction = null;
    
    mainMap.removeInteraction(selectInteraction); // Always remove to re-add if needed for 'edit'
    mainMap.removeInteraction(modifyInteraction);

    if (clearSelection && selectInteraction) {
        selectInteraction.getFeatures().clear();
        selectedFeature = null;
    }
    hidePropertiesPanel();
}

function initializeInteractions() {
    selectInteraction = new ol.interaction.Select({
        condition: ol.events.condition.click,
        layers: [evacGroupsLayer, exitsLayer, barriersLayer, drawnItemsLayer], // Only allow selection on these layers
        style: new ol.style.Style({ // Style for selected features
            image: new ol.style.Circle({
                radius: 8,
                fill: new ol.style.Fill({color: 'rgba(255, 0, 0, 0.3)'}),
                stroke: new ol.style.Stroke({color: 'red', width: 2}),
            }),
            stroke: new ol.style.Stroke({color: 'red', width: 3}),
        })
    });

    selectInteraction.on('select', function(e) {
        if (e.selected.length > 0) {
            selectedFeature = e.selected[0];
            if (!selectedFeature.get('featureType')) { // If drawn but not saved, derive type
                 if (selectedFeature.getGeometry().getType() === 'Point' && activeMode === 'incident') selectedFeature.set('featureType', 'evac_group');
                 else if (selectedFeature.getGeometry().getType() === 'Point' && activeMode === 'exit') selectedFeature.set('featureType', 'exit');
                 else if (selectedFeature.getGeometry().getType() === 'LineString' && activeMode === 'barrier') selectedFeature.set('featureType', 'barrier');
            }
            showPropertiesPanel(selectedFeature);
        } else {
            selectedFeature = null;
            hidePropertiesPanel();
        }
    });

    modifyInteraction = new ol.interaction.Modify({
        features: selectInteraction.getFeatures()
    });

    modifyInteraction.on('modifyend', function(e) {
        const feature = e.features.getArray()[0];
        if (feature && feature.get('db_id')) { // Only update if it's an existing, saved feature
            updateFeatureGeometry(feature);
        } else {
            showError("Cannot modify unsaved feature. Save it first or it's a new drawing.");
        }
    });
}

function addDrawInteraction(geometryType, featureType) {
    if (scenarioLocked) return;
    drawInteraction = new ol.interaction.Draw({
        source: drawSource, // Draw on the temporary drawSource
        type: geometryType
    });
    
    drawInteraction.on('drawstart', function() {
        if (selectInteraction) selectInteraction.getFeatures().clear(); // Deselect any features
        selectedFeature = null;
        hidePropertiesPanel();
    });

    drawInteraction.on('drawend', function(event) {
        const feature = event.feature;
        feature.set('featureType', featureType);
        
        if (featureType === 'evac_group') {
            const capacity = parseInt(document.getElementById('capacity').value) || 1;
            feature.set('capacity', capacity);
        }
        saveFeature(feature); // Save immediately to server
        mainMap.removeInteraction(drawInteraction); // Remove after one draw
        drawInteraction = null;
        // setMode('edit'); // Optionally switch to edit mode after drawing
    });
    mainMap.addInteraction(drawInteraction);
}


// --- Properties Panel ---
function showPropertiesPanel(feature) {
    if (scenarioLocked) return;
    const panel = document.getElementById('properties-panel');
    const capacityContainer = document.getElementById('capacity-container');
    const featureType = feature.get('featureType');

    capacityContainer.style.display = 'none'; // Hide by default

    if (featureType === 'evac_group') {
        capacityContainer.style.display = 'block';
        document.getElementById('capacity').value = feature.get('capacity') || 1;
    }
    panel.style.display = 'block';
}

function hidePropertiesPanel() {
    document.getElementById('properties-panel').style.display = 'none';
    document.getElementById('capacity-container').style.display = 'none';
}

// --- Feature CRUD Operations ---
async function saveFeature(feature) {
    if (scenarioLocked) return;
    const featureType = feature.get('featureType');
    showLoading(`Saving ${featureType}...`);

    const format = new ol.format.GeoJSON();
    const geometry = feature.getGeometry().clone().transform(mainMap.getView().getProjection(), 'EPSG:4326');
    const geojsonGeom = format.writeGeometryObject(geometry);

    const data = { geom: geojsonGeom }; // No longer stringifying geom

    if (featureType === 'evac_group') {
        data.capacity = feature.get('capacity') || 1;
    }

    try {
        // cntrl-f tag: manual url simulator:api_sim_new
        const response = await fetch(`/api/scenario/${scenarioId}/${featureType}/new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        const result = await response.json();

        if (result.id) {
            feature.set('db_id', result.id); // Set database ID on the OL feature
            feature.setId(result.id); // Set OL feature ID

            // Move feature from drawSource to the correct persistent layer's source
            drawSource.removeFeature(feature);
            if (featureType === 'evac_group') evacGroupsSource.addFeature(feature);
            else if (featureType === 'exit') exitsSource.addFeature(feature);
            else if (featureType === 'barrier') barriersSource.addFeature(feature);
            
            showStatus(`${featureType} saved successfully.`);
            if (routesExist) markRoutesAsInvalid(); // Mark routes invalid if they exist
        } else {
            throw new Error('Save operation did not return an ID.');
        }
    } catch (error) {
        console.error('Error saving feature:', error);
        showError(`Failed to save ${featureType}. ${error.message}`);
        drawSource.removeFeature(feature); // Remove from map if save failed
    } finally {
        hideLoading();
        updateActionButtonsVisibility();
    }
}

async function updateFeatureGeometry(feature) { // For move/vertex edits
    if (scenarioLocked || !feature || !feature.get('db_id')) return;
    
    const featureType = feature.get('featureType');
    const featureId = feature.get('db_id');
    showLoading(`Updating ${featureType} geometry...`);

    const format = new ol.format.GeoJSON();
    const geometry = feature.getGeometry().clone().transform(mainMap.getView().getProjection(), 'EPSG:4326');
    const geojsonGeom = format.writeGeometryObject(geometry);

    const data = { geom: geojsonGeom };

    try {
        // manual url simulator:api_sim_manage
        const response = await fetch(`/api/scenario/${scenarioId}/${featureType}/edit/${featureId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        await response.json();
        showStatus(`${featureType} geometry updated.`);
        if (routesExist) markRoutesAsInvalid();
    } catch (error) {
        console.error('Error updating feature geometry:', error);
        showError(`Failed to update ${featureType} geometry. ${error.message}`);
        // Consider reverting the geometry change on the map if the update fails
        // For now, we'll leave it, or you could refresh the layer source.
    } finally {
        hideLoading();
    }
}

async function updateFeatureProperties() { // For properties panel changes (e.g. capacity)
    if (scenarioLocked || !selectedFeature || !selectedFeature.get('db_id')) {
        showError("No selected feature or feature not saved yet.");
        return;
    }
    
    const featureType = selectedFeature.get('featureType');
    const featureId = selectedFeature.get('db_id');
    const data = {};

    if (featureType === 'evac_group') {
        const newCapacity = parseInt(document.getElementById('capacity').value) || 1;
        data.capacity = newCapacity;
    } else {
        showStatus("No updatable properties for this feature type.", "info");
        return;
    }

    showLoading(`Updating ${featureType} properties...`);
    try {
        const response = await fetch(`/api/scenario/${scenarioId}/${featureType}/edit/${featureId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify(data) // API needs to handle partial updates (only properties)
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        await response.json();

        if (data.capacity !== undefined) selectedFeature.set('capacity', data.capacity); // Update feature on map
        showStatus(`${featureType} properties updated.`);
        if (routesExist) markRoutesAsInvalid();
        evacGroupsLayer.getSource().changed(); // Force redraw if style depends on capacity
    } catch (error) {
        console.error('Error updating feature properties:', error);
        showError(`Failed to update ${featureType} properties. ${error.message}`);
    } finally {
        hideLoading();
    }
}

async function deleteSelectedFeature() {
    if (scenarioLocked || !selectedFeature || !selectedFeature.get('db_id')) {
         showError("No saved feature selected for deletion.");
        return;
    }

    const featureType = selectedFeature.get('featureType');
    const featureId = selectedFeature.get('db_id');

    if (!confirm(`Are you sure you want to delete this ${featureType}?`)) return;

    showLoading(`Deleting ${featureType}...`);
    try {
        const response = await fetch(`/api/scenario/${scenarioId}/${featureType}/delete/${featureId}`, {
            method: 'POST', // Django typically uses POST for delete if CSRF is involved
            headers: { 'X-CSRFToken': csrfToken }
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        await response.json();

        // Remove from the correct layer source
        if (featureType === 'evac_group') evacGroupsSource.removeFeature(selectedFeature);
        else if (featureType === 'exit') exitsSource.removeFeature(selectedFeature);
        else if (featureType === 'barrier') barriersSource.removeFeature(selectedFeature);
        
        selectedFeature = null;
        hidePropertiesPanel();
        selectInteraction.getFeatures().clear(); // Clear selection in OL
        
        showStatus(`${featureType} deleted.`);
        if (routesExist) markRoutesAsInvalid();
    } catch (error) {
        console.error('Error deleting feature:', error);
        showError(`Failed to delete ${featureType}. ${error.message}`);
    } finally {
        hideLoading();
        updateActionButtonsVisibility();
    }
}

async function updateScenarioName() {
    const newName = document.getElementById('scenarioName').value;
    if (newName === "{{ scenario.name }}") return; // No change

    showLoading("Updating scenario name...");
    try {
        // NOTE: New API endpoint needed: /api/scenario/<scenario_id>/rename
        const response = await fetch("{% url 'simulator:rename_scenario' scenario.id %}"", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify({ name: newName })
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        const result = await response.json();
        if (result.status === 'success') {
            showStatus("Scenario name updated.");
            document.title = `{{ building.name }} - ${newName}`; // Update page title
            // Optionally update {{ scenario.name }} if it's used elsewhere dynamically, though a page reload would fix it.
        } else {
            throw new Error(result.message || "Failed to update name.");
        }
    } catch (error) {
        console.error("Error updating scenario name:", error);
        showError(`Failed to update scenario name: ${error.message}`);
        document.getElementById('scenarioName').value = "{{ scenario.name }}"; // Revert on error
    } finally {
        hideLoading();
    }
}


// --- Routes and Simulation ---
function updateActionButtonsVisibility() {
    const hasEvacGroups = evacGroupsSource.getFeatures().length > 0;
    const hasExits = exitsSource.getFeatures().length > 0;

    const calcRoutesBtn = document.getElementById('calculate-routes-btn');
    const runSimBtn = document.getElementById('run-simulation-btn');

    // Calculate Routes button
    calcRoutesBtn.style.display = (hasEvacGroups && hasExits && !scenarioLocked) ? 'block' : 'none';
    
    // Run Simulation button
    // Visible if routes exist, are valid, and not locked
    runSimBtn.style.display = (routesExist && routesAreValid && !scenarioLocked) ? 'block' : 'none';
}

function checkRoutesState() {
    routesExist = evacRoutesSource.getFeatures().length > 0;
    if (routesExist) {
        // Check if ALL routes are valid. If even one is marked invalid (e.g., feature.get('valid') === false),
        // then routesAreValid should be false.
        // This requires the 'valid' property on route features.
        routesAreValid = evacRoutesSource.getFeatures().every(f => f.get('valid') !== false);
    } else {
        routesAreValid = false;
    }
    evacRoutesLayer.getSource().changed(); // Refresh layer style
    updateActionButtonsVisibility();
}


async function calculateRoutes() {
    if (scenarioLocked) return;
    showLoading('Calculating routes... (This may take a while)');
    try {
        // NOTE: Ensure your calculate_routes view exists and matches this URL pattern
        const response = await fetch({% url 'simulator:calculate_routes' building.id scenario.id %}, {
            method: 'POST',
            headers: { 'X-CSRFToken': csrfToken }
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        const result = await response.json();

        if (result.status === 'success' || result.message === 'Calculation started') { // Handle async process
            showStatus(result.message || 'Routes calculation started. Refreshing routes layer.', 'info');
            evacRoutesSource.refresh(); // Refresh the routes layer to load new routes
            // After refresh, featuresloadend on evacRoutesSource will trigger checkRoutesState
            // which will set routesAreValid = true (assuming new routes are valid)
            // For immediate feedback, one could optimistically set routesAreValid = true here.
            // For now, we rely on the refresh and load event.
            markRoutesAsValid(); // Explicitly mark as valid after calculation
        } else {
            throw new Error(result.message || 'Failed to start route calculation.');
        }
    } catch (error) {
        console.error('Error calculating routes:', error);
        showError(`Route calculation error: ${error.message}`);
    } finally {
        hideLoading();
    }
}

async function runSimulation() {
    if (scenarioLocked || !routesAreValid) {
        showError("Cannot run simulation: Scenario locked or routes are not valid/current.");
        return;
    }
    showLoading('Running simulation...');
    try {
        // NOTE: Ensure your run_simulation view exists and matches this URL pattern
        const response = await fetch({% url 'simulator:run_simulation' building.id scenario.id %}, {
            method: 'POST',
            headers: { 'X-CSRFToken': csrfToken }
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        const result = await response.json();

        if (result.status === 'success' || result.message === 'Simulation started') {
            showStatus('Simulation completed/started successfully.');
            // Server should update scenario.simulation_status. Client needs to check this.
            // For example, by fetching scenario details or relying on a flag from the response.
            // {{ scenario.simulation_status }} might be 'complete' after this.
            // We'll call checkSimulationStatus which should ideally get updated scenario state.
            // If simulation_status is part of the response, use it.
            if (result.simulation_status) { // Assuming API returns updated status
                 handlePostSimulationActions(result.simulation_status);
            } else {
                // Fallback: could refetch scenario data or rely on a timed check
                checkSimulationStatus(); // Re-check server status
            }
        } else {
            throw new Error(result.message || 'Failed to run simulation.');
        }
    } catch (error) {
        console.error('Error running simulation:', error);
        showError(`Simulation error: ${error.message}`);
    } finally {
        hideLoading();
    }
}

async function invalidateRoutes() {
    return fetch("{% url 'simulator:invalidate_routes' scenario.id %}", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken }
    });
}

async function markRoutesAsInvalid() {
    if (!routesExist) return;
    routesAreValid = false;
    evacRoutesSource.getFeatures().forEach(feature => feature.set('valid', false));
    evacRoutesLayer.getSource().changed(); // Refresh layer style
    updateActionButtonsVisibility();
    showStatus("Routes are now outdated due to changes. Please recalculate.", "info");

    try {
        await invalidateRoutes()
    } catch (error) { console.error("Failed to mark routes as invalid on server", error); }
}
function markRoutesAsValid() {
    // This should be called after successful route calculation IF the server doesn't provide 'valid'
    // or if we want to ensure client-side state is up-to-date.
    routesAreValid = true;
    evacRoutesSource.getFeatures().forEach(feature => feature.set('valid', true));
    evacRoutesLayer.getSource().changed();
    updateActionButtonsVisibility();
}


// --- Scenario State Management (Locking, Copying, Results) ---
async function checkSimulationStatus() {
    // This function could fetch current scenario status from the server
    // For now, it uses the Django template variable which might be stale if not page reloaded.
    // A dedicated API endpoint to get scenario status (including simulation_status and lock_status) would be better.
    // e.g., GET /api/scenario/<id>/status

    // Placeholder using template variable for initial load:
    const simulationCompleted = "{{ scenario.simulation_status }}" === "complete"; // Check your actual status strings
    
    handlePostSimulationActions("{{ scenario.simulation_status }}"); // Use the string from Django template
}


function handlePostSimulationActions(simulationStatus) {
    const editLockContainer = document.getElementById('edit-lock-container');
    const editLockSwitch = document.getElementById('editLockSwitch');
    const viewResultsBtn = document.getElementById('view-simulation-results-btn');

    if (simulationStatus === 'complete' || simulationStatus === 'Complete') { // Adjust string as per your model
        editLockContainer.style.display = 'block';
        editLockSwitch.checked = true; // Default to locked after simulation
        toggleEditLock(true); // Apply lock

        viewResultsBtn.style.display = 'block';
    } else {
        editLockContainer.style.display = 'none';
        editLockSwitch.checked = false;
        toggleEditLock(false); // Ensure unlocked if no results

        viewResultsBtn.style.display = 'none';
    }
    updateActionButtonsVisibility(); // Recalculate button visibility based on lock status
}


function toggleEditLock(isLocked) {
    scenarioLocked = isLocked;
    document.getElementById('editLockSwitch').checked = isLocked; // Sync switch
    try {
        fetch("{% url 'simulator:toggle_edit' scenario.id %}", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken }
        })
    } catch (error) {
        console.error("Error toggling edit:", error);
        showError(`Error toggling edit: ${error.message}`);
    }
    // Disable/Enable mode buttons
    document.querySelectorAll('.mode-button').forEach(btn => {
        btn.disabled = isLocked;
        if(isLocked) btn.classList.add('disabled'); else btn.classList.remove('disabled');
    });
    
    // Disable/Enable properties panel buttons (if panel is visible)
    if (document.getElementById('properties-panel').style.display === 'block') {
        document.querySelector('.properties-panel .btn-primary').disabled = isLocked;
        document.querySelector('.properties-panel .btn-danger').disabled = isLocked;
    }
    
    if (isLocked) {
        cancelInteractions(); // Remove draw/modify interactions
        activeMode = null; // Clear active mode
        document.querySelectorAll('.mode-button').forEach(btn => btn.classList.remove('active'));
        showStatus("Editing is LOCKED. Simulation results are present.", "info");
    } else {
        showStatus("Editing is UNLOCKED. Routes and simulation may need recalculation if changes are made.", "info");
        // When unlocking, you might want to mark routes as invalid if that's the desired workflow.
        // For now, unlocking simply allows editing again.
    }
    updateActionButtonsVisibility(); // Recalculate button visibility

    // NOTE: You might want an API call here to persist the lock state on the Scenario model
    // if 'scenarioLocked' should persist across sessions or for other users.
    // fetch(`/api/scenario/${scenarioId}/lock`, { method: 'POST', body: JSON.stringify({locked: isLocked}) ... });
}


function viewSimulationResults() {
    // NOTE: New URL and View needed for simulation results page
    window.location.href = `/building/${buildingId}/scenario/${scenarioId}/simulation_results_view`;
}

async function copyScenario() {
    const originalName = document.getElementById('scenarioName').value || "{{ scenario.name }}";
    const newScenarioName = `${originalName} (Copy)`;

    if (!confirm(`Create a copy of this scenario named "${newScenarioName}"?`)) return;

    showLoading("Copying scenario...");
    try {
        // NOTE: New API endpoint and view needed: /api/scenario/<scenario_id>/copy
        const response = await fetch(`/api/scenario/${scenarioId}/copy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify({ new_name: newScenarioName }) // Optional: pass new name
        });
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        const result = await response.json();

        if (result.status === 'success' && result.new_scenario_id) {
            showStatus("Scenario copied successfully. Redirecting...");
            window.location.href = `/building/${buildingId}/scenario/${result.new_scenario_id}/map`;
        } else {
            throw new Error(result.message || "Failed to copy scenario.");
        }
    } catch (error) {
        console.error("Error copying scenario:", error);
        showError(`Failed to copy scenario: ${error.message}`);
    } finally {
        hideLoading();
    }
}


// --- Utility Functions ---
function showStatus(message, type = 'success') {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    if (type !== 'info') setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
}
function showError(message) { showStatus(message, 'error'); }
function showLoading(message = 'Loading...') {
    document.getElementById('loading-text').textContent = message;
    document.getElementById('loading-indicator').style.display = 'flex';
}
function hideLoading() { document.getElementById('loading-indicator').style.display = 'none'; }

function getCsrfToken() {
    return document.querySelector('[name=csrfmiddlewaretoken]')?.value || 
           document.cookie.split('; ').find(row => row.startsWith('csrftoken='))?.split('=')[1];
}

// Initial call to set up button visibility based on current data
document.addEventListener('DOMContentLoaded', () => {
    // Allow sources to load features first
    const allSourcesLoaded = Promise.all([
        new Promise(resolve => evacGroupsSource.once('featuresloadend', resolve)),
        new Promise(resolve => exitsSource.once('featuresloadend', resolve)),
        new Promise(resolve => evacRoutesSource.once('featuresloadend', resolve))
    ]);

    allSourcesLoaded.then(() => {
        checkRoutesState(); // This will also call updateActionButtonsVisibility
    });
});
