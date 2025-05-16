from django.contrib import admin
from django.urls import path
from .views import *

urlpatterns = [
    path('building/new', upload_building_form, name='upload_building_form'),
    path('', home, name='home'),
    path('building/<int:building>/<str:layer>/upload', upload_layer, name='upload_layer'),
    path('buildings', buildings_list, name='building_list'),
    path('building/<int:building>/scenario', scenario_list, name='scenario_list'),
    path('building/<int:building>/scenario/new', create_scenario, name='create_scenario'),
    path('building/<int:building>/scenario/<int:scenario>/map', map_view, name='map_view'),
    path('api/scenario/<int:scenario>/<str:model>/<int:pk>/<str:action>', api_manage_sim_objects, name='api_sim_manage'),
    path('api/scenario/<int:scenario>/<str:model>/<str:action>', api_manage_sim_objects, name='api_sim_new'),
    path('api/geojson/', yield_geojson, name='api_geojson'),
    path('api/building/<int:building>/scenario/<int:scenario>/calculate_routes', calculate_routes, name='calculate_routes'),
    path('api/building/<int:building>/scenario/<int:scenario>/simulate', run_simulation, name='run_simulation'),
    path('api/building/<int:building>/scenario/<int:scenario>/copy', copy_scenario, name='copy_scenario'),
    path('api/scenario/<int:scenario>/rename', rename_scenario, name='rename_scenario'),
    path('api/scenario/<int:scenario>/evac_routes/invalidate', invalidate_routes, name='invalidate_routes'),
    path('api/scenario/<int:scenario>/edit_lock/toggle', toggle_edit_lock, name='toggle_edit'),
    path('building/<int:building>/scenario/<int:scenario>/simulation/view', simulation_results, name = 'simulation_results')
]