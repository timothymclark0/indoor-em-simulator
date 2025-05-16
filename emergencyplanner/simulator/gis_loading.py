import geopandas as gpd
import pandas as pd
from .models import Level, Detail, Building
from django.contrib.gis.geos import GEOSGeometry, MultiLineString, LineString
from django.http import JsonResponse
from django.conf import settings 
from django.forms.models import model_to_dict
from pathlib import Path
import os
from itertools import accumulate
from shapely.wkt import loads


def qs_to_gdf(queryset):
    df = pd.DataFrame([model_to_dict(x) for x in queryset])
    geometry = df['geom'].map(lambda x: loads(x.wkt))
    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs = 3857)
    index = pd.Index(gdf['id'])
    gdf.index = index
    gdf = gdf.drop(gdf[~(gdf['id'] > 0)].index, axis = 0)
    gdf = gdf.drop(['id','geom'], axis = 1)
    return gdf

def handle_uploaded_geojson(f, title, layer, building):
    filename = [settings.BASE_DIR,'uploads', 'simulator', 'buildings',  str(building.id), layer, f"{building.id}_{layer}_{title}.geojson"]
    # create full path to new file by checking the path at each step and mkdir-ing
    dirs = list(accumulate(filename, os.path.join))
    for d in dirs[:-1]:
        if not os.path.exists(d):
            os.mkdir(d)
            
    with open(dirs[-1], "wb+") as destination:
        for chunk in f.chunks():
            destination.write(chunk)
            
    return dirs[-1] #return filename for processing into models

def factory_router(file,layertype,building: Building):
    if layertype == 'level':
        level_factory(file,building)
    if layertype == 'detail':
        detail_factory(file,building)
        
def level_factory(file,building):
    gdf = gpd.read_file(file, crs=3857)
    model_fields = ['esri_id','long_name','short_name','order']
    ref_fields = ['LEVEL_ID','NAME_LONG','NAME','VERTICAL_ORDER']
    fields_idx = [x in gdf.columns for x in ref_fields]
    
    ex_target_fields = [_ for _ in [x * y for x,y in zip(ref_fields,fields_idx)] if _]
    ex_model_fields = [_ for _ in [x * y for x,y in zip(model_fields,fields_idx)] if _]

    #add error reporting
    for idx, row in gdf.iterrows():
        data = {model: row[target] for model, target in zip(ex_model_fields, ex_target_fields)}
        data['geom'] = GEOSGeometry(row['geometry'].wkt, srid = 3857)
        data['building'] = building
        Level(**data).save()
        
        
    return JsonResponse({'status':'success','loaded_levels':len(gdf)})

def detail_factory(file, building):
    #main difference is that we match to level instead of just building
    gdf = gpd.read_file(file, crs = 3857)
    model_fields = ['esri_id', 'use_type']
    ref_fields = ['DETAIL_ID', 'USE_TYPE']
    fields_idx = [x in gdf.columns for x in ref_fields]
    
    ex_target_fields = [_ for _ in [x * y for x,y in zip(ref_fields,fields_idx)] if _]
    ex_model_fields = [_ for _ in [x * y for x,y in zip(model_fields,fields_idx)] if _]

    #pull these now for performance- there are <10 levels, but 1000+ details
    level_candidates = Level.objects.filter(building = building)
    level_picker = {lvl.esri_id: lvl for lvl in level_candidates}
    
    #add error reporting
    for idx, row in gdf.iterrows():
        data = {model: row[target] for model, target in zip(ex_model_fields, ex_target_fields)}
        data['geom'] = GEOSGeometry(row['geometry'].wkt, srid = 3857)
        if type(data['geom']) == LineString:
            data['geom'] = MultiLineString(data['geom'])
        
        #iterate through level candidates to find which matches the detail id
        linked_level = next(filter(lambda x: x == row['DETAIL_ID'][:len(x)], level_picker.keys()))
        
        #select level object
        data['level'] = level_picker[linked_level]
        
        Detail(**data).save()
    return JsonResponse({'status':'success','loaded_levels':len(gdf)})
        