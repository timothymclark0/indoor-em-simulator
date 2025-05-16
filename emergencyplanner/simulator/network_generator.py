from .models import *
from .gis_loading import qs_to_gdf
import geopandas as gpd
import pandas as pd
import numpy as np
from shapely.wkt import loads
from shapely import bounds, Point
from django.contrib.gis.geos import GEOSGeometry
from itertools import chain, repeat

def generate_grid_points(bounds, spacing = 0.6):
    minx, miny, maxx, maxy = bounds
    
    # Generate coordinate arrays
    x_coords = np.arange(minx, maxx + spacing, spacing)
    y_coords = np.arange(miny, maxy + spacing, spacing)
    
    # Create mesh grid
    xx, yy = np.meshgrid(x_coords, y_coords, indexing='xy')
    
    # Create points list with correct indexing
    points = []
    indices = []
    
    # Iterate in reverse y order to match bottom-to-top ordering
    for y_idx, y in enumerate(y_coords[::-1]):
        for x_idx, x in enumerate(x_coords):
            points.append(Point(x, y))
            indices.append((x_idx, y_idx))
    
    # Create DataFrame with point indices
    df = pd.DataFrame({
        'x_idx': [idx[0] for idx in indices],
        'y_idx': [idx[1] for idx in indices],
        'geometry': points
    })
    
    # Convert to GeoDataFrame
    gdf = gpd.GeoDataFrame(df, geometry='geometry',crs = 'EPSG:3857')
    
    # Add coordinate columns for convenience
    gdf['x'] = gdf.geometry.x
    gdf['y'] = gdf.geometry.y
    mindex = pd.MultiIndex.from_tuples(indices, names = ['x','y'])
    gdf.index = mindex
    return gdf
def cost_function(d, max_penalty=1.8,max_d=5):
    return -(max_penalty / max_d)*d + max_penalty #linear penalty

def neighbors(x,y,x_max, y_max):
    neighbors = [(x+1, y-1), (x+1, y), (x, y+1), (x+1, y+1)]
    dropx = [True]*4
    dropy = [True]*4
    dropx =[True if x_target[1] < x_max and x_taget[1] >= 0 for x_target in neighbors else False]
    idx_list = [x*y for x,y in zip(dropx, dropy)]
    return [neighbors[i] for i in range(3) if idx_list[i]]

def load_edges(network, details, nodes):
    connections = set()
    edges = []
    x_max, y_max = nodes['x_idx'].max(), nodes['y_idx'].max()
    for coord in list(nodes.index):
        x,y = coord
        for neighbor in neighbors(x,y, x_max, y_max):
            if set(neighbor) not in connections and neighbor in nodes.index:
                edge = NetworkEdge(
                    from_node = nodes.loc[[(x,y)], 'model'].iloc[0],
                    to_node = nodes.loc[[neighbor], 'model'].iloc[0])
                edge.geom = edge.get_line()
                edge.wall_distance = edge.geom.distance(details)
                edge.cost = cost_function(edge.wall_distance) + edge.geom.length
                edges += [edge]
                connections |={(coord, neighbor)}
                connections |= {(neighbor, coord)}
    NetworkEdge.objects.bulk_create(edges)
    return NetworkEdge.objects.filter(from_node__network=network)
                    
def generate_network(scenario):
    network = Network(name = str(scenario.name + ' default network')[:40],
                    method ='auto',
                    scenario=scenario)
    network.save()
    footprint = Building.objects.get(pk = scenario.building.pk).footprint_calc()
    boundary = bounds(loads(footprint.wkt))    
    nodes = generate_grid_points(boundary, 0.6)
    nodes['model'] = nodes.apply(lambda row:
        NetworkNode(network = network,
            x = row['x_idx'],
            y = row['y_idx'],
            geom = GEOSGeometry(row['geometry'].wkt, srid=3857)),
            axis = 1)
    node_models = list(nodes['model'])
    NetworkNode.objects.bulk_create(node_models)
    print('nodes')
    nodes['model'] = node_models
    
    levels = [l.id for l in Level.objects.filter(building=scenario.building)]
    details = GEOSGeometry(
                qs_to_gdf(Detail.objects.filter(level__pk__in=levels)
                    .exclude(use_type__in=['A-DOOR'])).unary_union.wkt)
    
    edges = load_edges(network, details, nodes)
    print('edges')
    
    return edges
    
if __name__ == '__main__':
    scenario = Scenario.objects.get(pk=1)
    generate_network(scenario)
    