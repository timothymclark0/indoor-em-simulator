from django.core.serializers import serialize
from django.http import HttpResponseRedirect, Http404, HttpResponse, JsonResponse
from django.shortcuts import render, get_object_or_404
from django.urls import reverse
from .models import *
from .forms import *
from django.conf import settings
from .gis_loading import factory_router, handle_uploaded_geojson, qs_to_gdf
from itertools import repeat
import json
# Create your views here.

def home(request):
    return render(request, 'home.html')
def buildings_list(request):
    buildings = Building.objects.all()
    scenario_stats = {b.id: len(Scenario.objects.filter(building = b)) for b in buildings}
    print(scenario_stats)
    return render(request, 'building_list.html',{'buildings': buildings, 'scenario_stats':scenario_stats})

def map_view(request, building, scenario):
    building_obj = get_object_or_404(Building, pk=building)
    scenario_obj = get_object_or_404(Scenario, pk=scenario)
    
    qs = Level.objects.filter(building = building_obj)
    center = qs_to_gdf(qs).unary_union.centroid
    context = {'building': building_obj, 'scenario':scenario_obj, 'center':center}
    
    return render(request, 'map_view2.html', context)
def scenario_list(request, building=0):
    if building == 0:
        scenarios = Scenario.objects.all()
        building_objs = Building.objects.all()
    else:
        building_obj = get_object_or_404(Building, pk=building)
        building_objs = [building_obj]
        scenarios = Scenario.objects.filter(building = building_obj)
    sim_detail = {}
    for sc in scenarios:
        sim_detail[sc.pk] = {'network': False, 'routes': False}
        network = Network.objects.filter(scenario = sc)
        if len(network) > 0:
            sim_detail[sc.pk]['network'] = True
            routes = EvacRoute.objects.filter(network = network[0])
            if len(routes) > 0:
                sim_detail[sc.pk]['routes'] = True
        if sim_detail[sc.pk]['network'] and sim_detail[sc.pk]['routes'] and sc.simulation_status == 'complete':
            sim_detail[sc.pk]['sim_status'] = True
    cards = []  
    for building in building_objs:
        for sc in scenarios:
            card = [building, sc, sim_detail[sc.pk]]
            cards += [card]
    context = {'buildings': building_objs, 'cards': cards}
    return render(request,'scenario_list.html', context)

def upload_building_form(request):
    
    if request.method == 'POST':
        building_form = BuildingForm(request.POST)
        print(building_form.is_valid())
        if building_form.is_valid():
            
            bd = building_form.save(commit=True)
            return HttpResponseRedirect(reverse("simulator:upload_layer",current_app='simulator',
                    kwargs={'building':bd.id, 'layer':'level'}))
    else:
        building_form = BuildingForm()
    return render(request, 'building_form.html', {'form': building_form})

def upload_layer(request, layer, building):
    building_obj = get_object_or_404(Building, pk=building)
    if layer not in ['level','detail']:
        return Http404()
    if request.method == "POST":
        form = UploadGeoJson(request.POST, request.FILES)
        print(form.is_valid())
        print(form.errors)
        if form.is_valid():
            title = form.data['title']
            fname = handle_uploaded_geojson(request.FILES["upload"], title, layer, building_obj)
            response = factory_router(fname, layer, building_obj)
            if layer == 'level':
                return HttpResponseRedirect(reverse('simulator:upload_layer', kwargs = {'layer':'detail','building':building}))
            if layer == 'detail':
                return HttpResponseRedirect(reverse("simulator:home"))
        
        return render(request, 'upload_form.html',{'form':form, 'building': building_obj, 'layer': layer})
    else:
        form = UploadGeoJson()
        form.data['layer'] = layer        
        return render(request, 'upload_form.html',{'form':form, 'building': building_obj, 'layer': layer})

def create_scenario(request, building):
    #three forms: create tag, associate tag, create scenario
    building_obj = get_object_or_404(Building, pk=building)
    
    if request.method == "POST":
        scenario_instance = Scenario(building = building_obj)
        scenario = ScenarioForm(request.POST,instance = scenario_instance)
        create_tag = TagFormSet(request.POST)
        
        if create_tag.is_valid() and create_tag.has_changed():
            create_tag.save()
            return HttpResponseRedirect(reverse('simulator:create_scenario', kwargs= {'building':building}))
        
        if scenario.is_valid():
            sc_obj = scenario.save()
            scenario_tag = ScenarioTagFormSet(request.POST, form_kwargs={'instance': repeat(ScenarioTags(scenario = sc_obj))})
            if scenario_tag.is_valid() and scenario_tag.has_changed():
                scenario_tag.save()
            return HttpResponseRedirect(reverse('simulator:scenario_list', kwargs={'building': building}))   
        
        context = {'create_tag': create_tag,
               'scenario_tag': scenario_tag,
               'scenario':scenario,
               'building': building_obj}
        
        return render(request, 'create_scenario.html', context=context)
    else:
        create_tag = TagFormSet()
        scenario_tag = ScenarioTagFormSet()
        scenario = ScenarioForm()
        context = {'create_tag': create_tag,
                'scenario_tag': scenario_tag,
                'scenario':scenario,
                'building': building_obj}
        return render(request, 'create_scenario.html', context=context)

def yield_geojson(request):
    if request.method == 'GET':
        try:
            query = request.GET
            model, fk_model, fk_id = query['model'], query['fk'], query['fk_id']
            models = {'barrier':Barrier,
                        'evac_group': EvacGroup,
                        'exit':Exit,
                        'level': Level,
                        'scenario':Scenario,
                        'building':Building,
                        'detail':Detail,}
            if model not in models.keys() or fk_model not in models.keys():
                return HttpResponse(json.dumps({}))
            fk_model_obj = get_object_or_404(models[fk_model], pk = fk_id)
            #create and unpack a dict here so that fk_model evaluates to the string, then is passed as kwarg
            qs = models[model].objects.filter(**{fk_model: fk_model_obj})
            geojson = qs_to_gdf(qs).to_json()
            return HttpResponse(geojson)
        except Exception as e:
            print(e)
            return HttpResponse(json.dumps({}))
    return Http404()
"""
def map_view(request, building, scenario):
    building_obj = get_object_or_404(Building, pk= building)
    scenario_obj = get_object_or_404(Scenario, pk=scenario)
    levels = Level.objects.filter(building = building_obj)
    details = Detail.objects.filter(level__building=building_obj)
    exits = Exit.objects.filter(scenario = scenario)
    barriers = Barrier.objects.filter(scenario = scenario)
    evac_groups = EvacGroup.objects.filter(scenario=scenario)
    
    levels_gdf = qs_to_gdf(levels)
    details_json = serialize("geojson",details, srid = 4326)    
    
    center = levels_gdf.to_crs(epsg=4326).unary_union.centroid 
     
    context = {'building': building_obj,
               'scenario': scenario_obj,
               'levels': levels_gdf.to_json(to_wgs84=True),
               'details': details_gdf.to_json(to_wgs84=True),
               'center': center}
    
    return render(request, 'map_view.html', context)
"""
def api_manage_sim_objects(request,scenario,model,action,pk=None):
    if request.method == 'POST':
        models = {'barrier':Barrier,
                'evac_group': EvacGroup,
                'exit':Exit,}
        if model not in models.keys():
            return Http404()
        manager = models[model]
        actions = ['new','delete','edit']
        if action not in actions: 
            return Http404()
        match action:
            case 'edit':
                if not pk:
                    return Http404()
                data = json.loads(str(request.body, 'utf-8'))
                data['pk'] = pk
                object = manager(**data)
                object.save()
                return JsonResponse({'status':'success','id': object.pk})
            case 'delete':
                if not pk:
                    return Http404()
                object = get_object_or_404(manager,pk=pk)
                object.delete()
            case 'new':
                data = json.loads(str(request.body, 'utf-8'))
                print(data)
                data['scenario'] = get_object_or_404(Scenario, pk=scenario)
                object = manager(**data)
                object.save()
                return JsonResponse({'status':'success','id': object.pk})
        return JsonResponse({'status':'success','action':action,'model':model})
    return HttpResponseRedirect(reverse('simulator:home'))
        
def rename_scenario(request, scenario):
    try:
        data = json.loads(str(request.body, 'utf-8'))
        sc_obj = get_object_or_404(Scenario, pk=scenario)
        sc_obj.name = data['name']
        sc_obj.save()
        return JsonResponse({'status':'success'})
    except:
        return JsonResponse({'status':'failed'})

def invalidate_routes(request, scenario):
    if request.method == 'POST':
        try:
            routes = EvacRoute.objects.filter(network__scenario__pk = scenario)
            for r in routes:
                r.valid = False
                r.save() 
                return JsonResponse({'status':'success'})
        except:
            return JsonResponse({'status':'failed'})
    return Http404()

def toggle_edit_lock(request, scenario):
    if request.method == "POST":
        try:
            sc_obj = Scenario.objects.get(pk=scenario)
            data = json.loads(str(request.body, 'utf-8'))
            sc_obj.edit_lock = data['edit_lock']
            print(data, sc_obj)
            sc_obj.save()
            return JsonResponse({'status':'success'})
        except:
            return JsonResponse({'status':'failed'})
    print('404d')
    return Http404()
def calculate_routes(request, building, scenario):
    # this will pull the relevant objects and call the network solver
    pass 

def run_simulation(request, building, scenario):
    pass

def copy_scenario(request, building, scenario):
    pass

def simulation_results(request):
    return Http404('coming soon')