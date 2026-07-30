// 全局变量
let mapChart = null;
let dataStore = null;
let isUnlocked = false;
let filteredData = null;
let currentRegion = null;
let currentProvince = null;

// 省份显示全称映射（用于UI展示）
const provinceFullNames = {
    '北京': '北京市', '天津': '天津市', '上海': '上海市', '重庆': '重庆市',
    '河北': '河北省', '山西': '山西省', '辽宁': '辽宁省', '吉林': '吉林省', '黑龙江': '黑龙江省',
    '江苏': '江苏省', '浙江': '浙江省', '安徽': '安徽省', '福建': '福建省', '江西': '江西省', '山东': '山东省',
    '河南': '河南省', '湖北': '湖北省', '湖南': '湖南省', '广东': '广东省', '海南': '海南省',
    '四川': '四川省', '贵州': '贵州省', '云南': '云南省', '陕西': '陕西省', '甘肃': '甘肃省', '青海': '青海省',
    '台湾': '台湾省',
    '内蒙古': '内蒙古自治区', '广西': '广西壮族自治区', '西藏': '西藏自治区', '宁夏': '宁夏回族自治区', '新疆': '新疆维吾尔自治区',
    '香港': '香港特别行政区', '澳门': '澳门特别行政区'
};

function getProvinceDisplayName(name) {
    return provinceFullNames[name] || (name + '省');
}

// 区域映射
const regionMap = {
    '华北': ['北京', '天津', '河北', '山西', '内蒙古'],
    '东北': ['辽宁', '吉林', '黑龙江'],
    '华东': ['上海', '江苏', '浙江', '安徽', '福建', '江西', '山东'],
    '中南': ['河南', '湖北', '湖南', '广东', '广西', '海南'],
    '西南': ['重庆', '四川', '贵州', '云南', '西藏'],
    '西北': ['陕西', '甘肃', '青海', '宁夏', '新疆']
};

// 省份在左侧/右侧的分布
const leftProvinces = ['陕西', '湖北', '四川', '湖南', '重庆', '广西'];
const rightProvinces = ['黑龙江', '内蒙古', '辽宁', '北京', '天津', '山西', '山东', '江苏', '上海', '浙江'];

// 工具函数：姓名脱敏
function maskName(name) {
    if (!name) return '';
    return name.charAt(0) + '同学';
}

// 工具函数：显示姓名（解锁后）
function displayName(student) {
    return isUnlocked ? student.name : student.maskedName;
}

// 工具函数：节流
function throttle(fn, delay) {
    let lastTime = 0;
    return function (...args) {
        const now = Date.now();
        if (now - lastTime >= delay) {
            lastTime = now;
            fn.apply(this, args);
        }
    };
}

// 加载数据
async function loadData() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error('数据加载失败');
        }
        dataStore = await response.json();
        
        // 初始化过滤数据
        filteredData = {
            students: [...dataStore.students],
            cityStats: [...dataStore.cityStats]
        };

        return true;
    } catch (error) {
        console.error('加载数据失败:', error);
        showToast('数据加载失败，请刷新页面重试');
        return false;
    }
}

// 加载中国地图GeoJSON
async function loadMapData() {
    try {
        const response = await fetch('data/china_full.json');
        if (!response.ok) {
            throw new Error('地图数据加载失败');
        }
        const geoJson = await response.json();
        echarts.registerMap('china', geoJson);
        
        return true;
    } catch (error) {
        console.error('地图数据加载失败:', error);
        // 尝试加载备用地图数据
        try {
            const response2 = await fetch('data/china.json');
            if (response2.ok) {
                const geoJson2 = await response2.json();
                echarts.registerMap('china', geoJson2);
                return true;
            }
        } catch (e) {
            console.error('备用地图数据也加载失败:', e);
        }
        return false;
    }
}

// 热力图画布层
let heatmapCanvas = null;
let heatmapCtx = null;

// 初始化热力图画布层
function initHeatmapCanvas() {
    const chartDom = document.getElementById('chinaMap');
    // 创建canvas层放在echarts canvas之下（热力图作为底层背景）
    heatmapCanvas = document.createElement('canvas');
    heatmapCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    // 插入到chartDom最前面，使其位于echarts canvas下层
    chartDom.insertBefore(heatmapCanvas, chartDom.firstChild);
    heatmapCtx = heatmapCanvas.getContext('2d');
}

// 绘制热力图
function drawHeatmap() {
    if (!heatmapCanvas || !heatmapCtx || !mapChart) return;
    
    const rect = heatmapCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // 设置canvas分辨率
    heatmapCanvas.width = rect.width * dpr;
    heatmapCanvas.height = rect.height * dpr;
    heatmapCanvas.style.width = rect.width + 'px';
    heatmapCanvas.style.height = rect.height + 'px';
    heatmapCtx.scale(dpr, dpr);
    heatmapCtx.clearRect(0, 0, rect.width, rect.height);
    
    // 将城市数据转换为屏幕坐标
    const points = filteredData.cityStats.map(city => {
        const pixel = mapChart.convertToPixel('geo', city.coords);
        if (!pixel || isNaN(pixel[0]) || isNaN(pixel[1])) return null;
        return {
            x: pixel[0],
            y: pixel[1],
            count: city.count,
            city: city.city,
            province: city.province,
            studentIds: city.studentIds
        };
    }).filter(Boolean);
    
    if (points.length === 0) return;
    
    // 计算每个点的热力半径（根据count）
    const maxCount = Math.max(...points.map(p => p.count));
    
    // 绘制热力图（多层径向渐变叠加）
    points.forEach(point => {
        const intensity = point.count / maxCount;
        // 根据学生数量调整影响半径（进一步减小）
        const radius = Math.max(8, Math.min(20, point.count * 1.2 + 3));
        
        // 创建径向渐变
        const gradient = heatmapCtx.createRadialGradient(
            point.x, point.y, 0,
            point.x, point.y, radius
        );
        
        // 根据强度调整颜色和透明度（降低透明度，更通透）
        const alpha = Math.min(0.4, 0.12 + intensity * 0.28);
        
        // 颜色渐变：蓝→青→黄→红
        gradient.addColorStop(0, `rgba(255, 80, 80, ${alpha})`);
        gradient.addColorStop(0.3, `rgba(255, 180, 60, ${alpha * 0.8})`);
        gradient.addColorStop(0.6, `rgba(255, 230, 100, ${alpha * 0.5})`);
        gradient.addColorStop(1, 'rgba(100, 180, 255, 0)');
        
        heatmapCtx.fillStyle = gradient;
        heatmapCtx.beginPath();
        heatmapCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        heatmapCtx.fill();
    });
    
    // 叠加混合模式使热点区域更明显
    // 使用 'lighter' 混合模式使重叠区域更亮
}

// 重绘热力图（用于地图交互后）
function redrawHeatmap() {
    // 清空画布并重新绘制
    if (heatmapCtx) {
        const rect = heatmapCanvas.getBoundingClientRect();
        heatmapCtx.clearRect(0, 0, rect.width, rect.height);
    }
    drawHeatmap();
}

// 初始化地图
function initMap() {
    const chartDom = document.getElementById('chinaMap');
    
    // 确保chartDom有position:relative
    chartDom.style.position = 'relative';
    
    mapChart = echarts.init(chartDom);
    
    // 初始化热力图画布
    initHeatmapCanvas();

    // 准备散点数据
    const scatterData = filteredData.cityStats.map(city => ({
        name: city.city,
        value: [...city.coords, city.count],
        count: city.count,
        studentIds: city.studentIds,
        province: city.province
    }));

    const option = {
        backgroundColor: 'transparent',
        geo: {
            map: 'china',
            roam: true,
            zoom: 1.2,
            center: [104.5, 36],
            label: {
                show: false
            },
            itemStyle: {
                areaColor: '#f5f7fa',
                borderColor: '#d0d7de',
                borderWidth: 0.8
            },
            emphasis: {
                label: {
                    show: true,
                    color: '#1e6fd9',
                    fontSize: 12,
                    formatter: function(params) {
                        return provinceFullNames[params.name] || params.name + '省';
                    }
                },
                itemStyle: {
                    areaColor: '#c5dbf5',
                    borderColor: '#1e6fd9',
                    borderWidth: 1.5
                }
            },
            select: {
                label: {
                    show: true,
                    color: '#1e6fd9'
                },
                itemStyle: {
                    areaColor: '#a8cfff',
                    borderColor: '#1e6fd9',
                    borderWidth: 2
                }
            },
            regions: [
                { name: '北京', itemStyle: { areaColor: '#FDE2E4' } },
                { name: '天津', itemStyle: { areaColor: '#FAD2E1' } },
                { name: '上海', itemStyle: { areaColor: '#F8E8F0' } },
                { name: '重庆', itemStyle: { areaColor: '#FFF0F5' } },
                { name: '河北', itemStyle: { areaColor: '#E0E7FF' } },
                { name: '山西', itemStyle: { areaColor: '#E8EAF6' } },
                { name: '辽宁', itemStyle: { areaColor: '#FCE4EC' } },
                { name: '吉林', itemStyle: { areaColor: '#E3F2FD' } },
                { name: '黑龙江', itemStyle: { areaColor: '#E1F5FE' } },
                { name: '江苏', itemStyle: { areaColor: '#E8F5E9' } },
                { name: '浙江', itemStyle: { areaColor: '#F1F8E9' } },
                { name: '安徽', itemStyle: { areaColor: '#FFFDE7' } },
                { name: '福建', itemStyle: { areaColor: '#FFF8E1' } },
                { name: '江西', itemStyle: { areaColor: '#FFF3E0' } },
                { name: '山东', itemStyle: { areaColor: '#FFECB3' } },
                { name: '河南', itemStyle: { areaColor: '#FFE0B2' } },
                { name: '湖北', itemStyle: { areaColor: '#E8EAF6' } },
                { name: '湖南', itemStyle: { areaColor: '#F3E5F5' } },
                { name: '广东', itemStyle: { areaColor: '#FCE4EC' } },
                { name: '海南', itemStyle: { areaColor: '#E0F7FA' } },
                { name: '四川', itemStyle: { areaColor: '#E8EAF6' } },
                { name: '贵州', itemStyle: { areaColor: '#F1F8E9' } },
                { name: '云南', itemStyle: { areaColor: '#FBE9E7' } },
                { name: '陕西', itemStyle: { areaColor: '#FFF3E0' } },
                { name: '甘肃', itemStyle: { areaColor: '#F3E5F5' } },
                { name: '青海', itemStyle: { areaColor: '#E8F5E9' } },
                { name: '内蒙古', itemStyle: { areaColor: '#ECEFF1' } },
                { name: '广西', itemStyle: { areaColor: '#F1F8E9' } },
                { name: '西藏', itemStyle: { areaColor: '#EDE7F6' } },
                { name: '宁夏', itemStyle: { areaColor: '#FCE4EC' } },
                { name: '新疆', itemStyle: { areaColor: '#E3F2FD' } },
                { name: '香港', itemStyle: { areaColor: '#FFCCBC' } },
                { name: '澳门', itemStyle: { areaColor: '#D7CCC8' } },
                { name: '台湾', itemStyle: { areaColor: '#B2DFDB' } }
            ]
        },
        tooltip: {
            show: false
        },
        series: [
            {
                name: '同学分布',
                type: 'effectScatter',
                coordinateSystem: 'geo',
                data: scatterData.map(item => ({
                    name: item.name,
                    value: item.value,
                    count: item.count,
                    studentIds: item.studentIds,
                    province: item.province
                })),
                symbolSize: function(val) {
                    const count = val[2];
                    return Math.max(4, Math.min(10, count * 0.5 + 2));
                },
                showEffectOn: 'render',
                rippleEffect: {
                    brushType: 'stroke',
                    scale: 2,
                    period: 4
                },
                hoverAnimation: true,
                label: {
                    show: true,
                    formatter: '{b}',
                    position: 'top',
                    color: '#1e6fd9',
                    fontSize: 12,
                    fontWeight: '500'
                },
                labelLayout: {
                    moveOverlap: 'shiftY',
                    hideOverlap: false
                },
                itemStyle: {
                    shadowBlur: 10,
                    shadowColor: 'rgba(30, 111, 217, 0.5)',
                    color: function(params) {
                        const count = params.data.count;
                        if (count >= 10) return '#d32f2f';
                        if (count >= 5) return '#f57c00';
                        if (count >= 3) return '#fbc02d';
                        if (count >= 2) return '#66bb6a';
                        return '#42a5f5';
                    }
                },
                emphasis: {
                    label: {
                        show: true,
                        fontSize: 14,
                        fontWeight: 'bold'
                    }
                },
                zlevel: 3
            }
        ]
    };

    mapChart.setOption(option);
    
    // 等待echarts渲染完成后绘制热力图
    setTimeout(() => {
        drawHeatmap();
    }, 100);

    // 添加点击事件
    mapChart.on('click', function(params) {
        if (params.seriesType === 'effectScatter' || params.seriesType === 'scatter') {
            showCityDetail(params.data);
        } else if (params.componentType === 'geo' || params.seriesType === 'map') {
            // 点击省份
            if (params.name) {
                showProvinceDetail(params.name);
            }
        }
    });

    // 添加鼠标移动事件实现自定义tooltip
    mapChart.on('mouseover', function(params) {
        if (params.seriesType === 'effectScatter') {
            showCustomTooltip(params);
        }
    });

    mapChart.on('mouseout', function() {
        hideCustomTooltip();
    });
    
    // 监听地图交互事件重绘热力图
    mapChart.on('georoam', function() {
        // 使用防抖优化性能
        clearTimeout(window._heatmapTimer);
        window._heatmapTimer = setTimeout(() => {
            redrawHeatmap();
        }, 50);
    });
    
    mapChart.on('geodragend', function() {
        redrawHeatmap();
    });
    
    mapChart.on('geozoom', function() {
        clearTimeout(window._heatmapTimer);
        window._heatmapTimer = setTimeout(() => {
            redrawHeatmap();
        }, 50);
    });
    
    // 响应窗口大小变化
    window.addEventListener('resize', function() {
        mapChart.resize();
        clearTimeout(window._heatmapTimer);
        window._heatmapTimer = setTimeout(() => {
            redrawHeatmap();
        }, 200);
    });
}

// 根据脱敏姓名查找学生信息（仅用于tooltip显示）
function getStudentByMaskedName(maskedName) {
    if (!dataStore) return null;
    return dataStore.students.find(s => s.maskedName === maskedName) || null;
}

// 根据ID查找学生信息
function getStudentById(id) {
    if (!dataStore) return null;
    return dataStore.students.find(s => s.id === id) || null;
}

// 获取城市的学生列表（通过ID）
function getCityStudents(cityData) {
    if (!cityData.studentIds) return [];
    return cityData.studentIds.map(id => getStudentById(id)).filter(s => s);
}

// 当前tooltip的城市数据
let currentTooltipData = null;
let tooltipHideTimer = null;

// 显示自定义提示框
function showCustomTooltip(params) {
    const tooltip = document.getElementById('mapTooltip');
    const data = params.data;
    
    // 清除隐藏计时器
    if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
    }
    
    if (!data || !data.name) {
        tooltip.style.display = 'none';
        return;
    }
    
    // 保存当前城市数据供点击使用
    currentTooltipData = data;
    
    // 获取该城市的学生列表（通过ID）
    const students = getCityStudents(data);
    
    let html = `
        <div class="tooltip-title">${data.name || data.city} · ${getProvinceDisplayName(data.province)} <span style="float:right;color:#ffd700;">${data.count}人</span></div>
    `;
    
    students.forEach(student => {
        const displayName = isUnlocked ? student.name : student.maskedName;
        html += `
            <div class="tooltip-student">
                <span class="tooltip-name">${displayName}</span>
                <span class="tooltip-uni">${student.university}</span>
            </div>
        `;
    });
    
    html += `<div style="margin-top:8px;color:#4a9eff;font-size:12px;text-align:center;font-weight:500;">👆 点击查看详情</div>`;
    
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.opacity = '1';
    
    // 使用正确的坐标位置
    const event = params.event || (params.event.event ? params.event.event : null);
    if (event) {
        let clientX = event.clientX;
        let clientY = event.clientY;
        
        // 限制在视口内
        const tooltipWidth = 280;
        let tooltipHeight = Math.min(40 + data.count * 35, 350);
        let left = clientX + 15;
        let top = clientY + 15;
        
        if (left + tooltipWidth > window.innerWidth) {
            left = clientX - tooltipWidth - 15;
        }
        if (top + tooltipHeight > window.innerHeight) {
            top = clientY - tooltipHeight - 15;
        }
        
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }
}

// 隐藏自定义提示框（延迟隐藏，防止鼠标移动到tooltip时消失）
function hideCustomTooltip() {
    const tooltip = document.getElementById('mapTooltip');
    
    // 延迟隐藏，给用户时间移动鼠标到tooltip
    tooltipHideTimer = setTimeout(() => {
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.style.display = 'none';
            currentTooltipData = null;
        }, 200);
    }, 300);
}

// 初始化tooltip交互（鼠标移入保持显示，点击打开详情）
function initTooltipInteraction() {
    const tooltip = document.getElementById('mapTooltip');
    
    tooltip.addEventListener('mouseenter', () => {
        // 鼠标进入tooltip时，取消隐藏
        if (tooltipHideTimer) {
            clearTimeout(tooltipHideTimer);
            tooltipHideTimer = null;
        }
        tooltip.style.opacity = '1';
    });
    
    tooltip.addEventListener('mouseleave', () => {
        // 鼠标离开tooltip时，隐藏
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.style.display = 'none';
            currentTooltipData = null;
        }, 200);
    });
    
    tooltip.addEventListener('click', () => {
        // 点击tooltip时，显示城市详情
        if (currentTooltipData) {
            showCityDetail(currentTooltipData);
            tooltip.style.display = 'none';
            currentTooltipData = null;
        }
    });
}

// 显示城市详情
function showCityDetail(cityData) {
    const modal = document.getElementById('detailModal');
    const title = document.getElementById('detailTitle');
    const body = document.getElementById('detailBody');
    
    const cityName = cityData.city || cityData.name;
    title.textContent = `${cityName} · ${getProvinceDisplayName(cityData.province)}`;
    
    // 获取该城市的学生列表（通过ID）
    const students = getCityStudents(cityData);
    
    // 按学校分组合并
    const universityGroups = {};
    students.forEach(student => {
        if (!universityGroups[student.university]) {
            universityGroups[student.university] = [];
        }
        universityGroups[student.university].push(student);
    });
    
    let html = `
        <div class="detail-city-info">
            <span class="detail-city-icon">📍</span>
            <div>
                <div class="detail-city-name">${cityData.count} 名同学录取到此</div>
                <div class="detail-city-province">${getProvinceDisplayName(cityData.province)}</div>
            </div>
        </div>
    `;
    
    // 按学校分组显示
    Object.entries(universityGroups).forEach(([university, students]) => {
        html += `
            <div style="background:linear-gradient(135deg, rgba(30,111,217,0.05), rgba(74,158,255,0.02));border-radius:8px;padding:10px 12px;margin:10px 0;">
                <div style="font-weight:500;color:var(--primary-dark);margin-bottom:6px;font-size:14px;">🎓 ${university} <span style="color:#888;font-weight:400;font-size:12px;">(${students.length}人)</span></div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
        `;
        
        students.forEach(student => {
            const displayName = isUnlocked ? student.name : student.maskedName;
            html += `<span style="background:#fff;border:1px solid #e0e8f0;border-radius:12px;padding:3px 10px;font-size:13px;color:#555;">${displayName}</span>`;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    body.innerHTML = html;
    
    modal.classList.add('show');
}

// 显示省份详情
function showProvinceDetail(provinceName) {
    const modal = document.getElementById('detailModal');
    const title = document.getElementById('detailTitle');
    const body = document.getElementById('detailBody');
    
    // 获取该省份的所有城市数据
    const provinceCities = filteredData.cityStats.filter(c => c.province === provinceName);
    const totalStudents = provinceCities.reduce((sum, c) => sum + c.count, 0);
    
    title.textContent = getProvinceDisplayName(provinceName);
    
    let html = `
        <div class="detail-city-info">
            <span class="detail-city-icon">🗺️</span>
            <div>
                <div class="detail-city-name">${totalStudents} 名同学分布在${provinceCities.length}个城市</div>
            </div>
        </div>
    `;
    
    provinceCities.forEach(city => {
        // 获取该城市的学生列表（通过ID）
        const students = getCityStudents(city);
        
        // 按学校分组合并
        const universityGroups = {};
        students.forEach(student => {
            if (!universityGroups[student.university]) {
                universityGroups[student.university] = [];
            }
            universityGroups[student.university].push(student);
        });
        
        html += `
            <div style="margin-top:15px;">
                <div style="font-weight:600;color:var(--primary-color);margin-bottom:8px;font-size:16px;">
                    📍 ${city.city} <span style="color:#ffd700;font-weight:400;font-size:14px;">${city.count}人</span>
                </div>
        `;
        
        // 按学校分组显示
        Object.entries(universityGroups).forEach(([university, students]) => {
            html += `
                <div style="background:linear-gradient(135deg, rgba(30,111,217,0.05), rgba(74,158,255,0.02));border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                    <div style="font-weight:500;color:var(--primary-dark);margin-bottom:6px;font-size:14px;">🎓 ${university} <span style="color:#888;font-weight:400;font-size:12px;">(${students.length}人)</span></div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
            `;
            
            students.forEach(student => {
                const displayName = isUnlocked ? student.name : student.maskedName;
                html += `<span style="background:#fff;border:1px solid #e0e8f0;border-radius:12px;padding:3px 10px;font-size:13px;color:#555;">${displayName}</span>`;
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        html += `
            </div>
        `;
    });
    
    body.innerHTML = html;
    modal.classList.add('show');
}

// 关闭详情弹窗
document.getElementById('detailCloseBtn').addEventListener('click', function() {
    document.getElementById('detailModal').classList.remove('show');
});

// 生成省份卡片列表
function generateProvinceList() {
    const leftList = document.getElementById('leftProvinceList');
    const rightList = document.getElementById('rightProvinceList');
    
    // 如果元素不存在则跳过（roster页面不需要）
    if (!leftList || !rightList) return;
    
    // 统计每个省份的数据
    const provinceData = {};
    filteredData.students.forEach(student => {
        const province = student.province;
        if (!provinceData[province]) {
            provinceData[province] = {
                province: province,
                students: [],
                cities: new Set()
            };
        }
        provinceData[province].students.push(student);
        provinceData[province].cities.add(student.city);
    });

    // 生成左侧列表
    leftList.innerHTML = generateProvinceCards(leftProvinces, provinceData, 'left');
    
    // 生成右侧列表
    rightList.innerHTML = generateProvinceCards(rightProvinces, provinceData, 'right');
}

// 生成省份卡片HTML
function generateProvinceCards(provinces, provinceData, side) {
    let html = '';
    const animationClass = side === 'left' ? 'slide-in-left' : 'slide-in-right';
    
    provinces.forEach(province => {
        if (provinceData[province]) {
            const data = provinceData[province];
            const students = data.students;
            const count = students.length;
            
            // 只显示前3个，其余折叠
            const displayCount = Math.min(count, 3);
            const showMore = count > 3;
            
            let studentsHtml = '';
            for (let i = 0; i < displayCount; i++) {
                const student = students[i];
                const displayName = isUnlocked ? student.name : student.maskedName;
                studentsHtml += `
                    <div class="student-item">
                        <span class="student-name">${displayName}</span>
                        <span class="student-city">· ${student.city}</span>
                    </div>
                `;
            }
            
            html += `
                <div class="province-card ${animationClass}" data-province="${province}">
                    <div class="province-header">
                        <span class="province-name">${getProvinceDisplayName(province)}</span>
                        <span class="province-count">${count}人</span>
                    </div>
                    <div class="province-students">
                        ${studentsHtml}
                    </div>
                    ${showMore ? `<div class="more-link" data-province="${province}">还有${count - displayCount}人 ▼</div>` : ''}
                </div>
            `;
        }
    });
    
    return html;
}

// 更新省份卡片显示（解锁后重新渲染）
function updateProvinceCards() {
    generateProvinceList();
}

// 更新统计数字
function updateStats() {
    document.getElementById('totalStudents').textContent = 50;
    document.getElementById('totalCities').textContent = filteredData.cityStats.length;
    
    const universities = new Set(filteredData.students.map(s => s.university));
    document.getElementById('totalUniversities').textContent = universities.size;
    
    const provinces = new Set(filteredData.students.map(s => s.province));
    document.getElementById('totalProvinces').textContent = provinces.size;
}

// 刷新地图数据
function refreshMap() {
    if (!mapChart) return;
    
    const scatterData = filteredData.cityStats.map(city => ({
        name: city.city,
        value: [...city.coords, city.count],
        count: city.count,
        studentIds: city.studentIds,
        province: city.province
    }));

    mapChart.setOption({
        series: [
            {
                data: scatterData
            }
        ]
    });
    
    // 重绘热力图
    setTimeout(() => {
        redrawHeatmap();
    }, 150);
}

// 应用筛选
function applyFilters() {
    let result = {
        students: [...dataStore.students],
        cityStats: [...dataStore.cityStats]
    };

    // 按地区筛选
    if (currentRegion) {
        const provinces = regionMap[currentRegion] || [];
        result.students = result.students.filter(s => provinces.includes(s.province));
        result.cityStats = result.cityStats.filter(c => provinces.includes(c.province));
    }

    // 按省份筛选
    if (currentProvince) {
        result.students = result.students.filter(s => s.province === currentProvince);
        result.cityStats = result.cityStats.filter(c => c.province === currentProvince);
    }

    filteredData = result;
    updateStats();
    generateProvinceList();
    refreshMap();
}

// 重置筛选
function resetFilters() {
    currentRegion = null;
    currentProvince = null;
    
    filteredData = {
        students: [...dataStore.students],
        cityStats: [...dataStore.cityStats]
    };
    
    updateStats();
    generateProvinceList();
    refreshMap();
}

// 显示提示信息
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        z-index: 10000;
        font-size: 14px;
        animation: fadeIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// 更新奋斗同学列表
function updateStrugglingList() {
    const strugglingList = document.getElementById('strugglingList');
    if (!strugglingList) return;
    
    const strugglingStudents = ['陈裕禧', '李乐瑄', '李欣橦', '赖宸熹'];
    strugglingList.innerHTML = strugglingStudents.map(name => {
        const maskedName = maskName(name);
        const displayName = isUnlocked ? name : maskedName;
        return `<span class="struggling-item">${displayName}</span>`;
    }).join('');
}

// 解锁姓名功能
function initUnlockFunction() {
    const unlockBtn = document.getElementById('unlockBtn');
    const unlockModal = document.getElementById('unlockModal');
    const unlockCloseBtn = document.getElementById('unlockCloseBtn');
    const unlockSubmitBtn = document.getElementById('unlockSubmitBtn');
    const unlockInput = document.getElementById('unlockInput');
    const unlockHint = document.getElementById('unlockHint');
    const achievementModal = document.getElementById('achievementModal');
    const achievementText = document.getElementById('achievementText');
    const achievementCloseBtn = document.getElementById('achievementCloseBtn');

    unlockBtn.addEventListener('click', () => {
        if (isUnlocked) {
            showToast('已解锁，所有姓名可见');
            return;
        }
        unlockModal.classList.add('show');
        setTimeout(() => unlockInput.focus(), 100);
    });

    unlockCloseBtn.addEventListener('click', () => {
        unlockModal.classList.remove('show');
        unlockInput.value = '';
        unlockHint.textContent = '';
        unlockHint.className = 'unlock-hint';
    });

    unlockSubmitBtn.addEventListener('click', handleUnlock);

    unlockInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleUnlock();
        }
    });

    function handleUnlock() {
        const input = unlockInput.value.trim();
        if (!input) {
            unlockHint.textContent = '请输入同学姓名';
            unlockHint.className = 'unlock-hint';
            return;
        }

        const student = dataStore.students.find(s => s.name === input);
        if (student) {
            isUnlocked = true;
            unlockModal.classList.remove('show');
            
            // 显示成就弹窗
            achievementText.textContent = `恭喜${student.name}录取到${student.university}（${student.city}）！`;
            achievementModal.classList.add('show');
            
            // 更新所有显示
            updateProvinceCards();
            refreshMap();
            updateStrugglingList();
            
            // 更新解锁按钮状态
            unlockBtn.querySelector('.icon').textContent = '🔒';
            unlockBtn.querySelector('span:last-child').textContent = '已解锁';
            unlockBtn.style.background = 'linear-gradient(135deg, #27ae60, #2ecc71)';
            
            unlockInput.value = '';
            unlockHint.textContent = '';
            unlockHint.className = 'unlock-hint';
        } else {
            unlockHint.textContent = '姓名不正确，请检查后重试';
            unlockHint.className = 'unlock-hint';
            unlockInput.style.borderColor = '#ff6b6b';
            setTimeout(() => {
                unlockInput.style.borderColor = '';
            }, 1000);
        }
    }

    achievementCloseBtn.addEventListener('click', () => {
        achievementModal.classList.remove('show');
    });
}

// 缩放控制
let currentZoom = 1.2;
let currentCenter = [104.5, 36];

function initMapControls() {
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const resetZoomBtn = document.getElementById('resetZoomBtn');
    
    // 放大
    zoomInBtn.addEventListener('click', () => {
        if (mapChart) {
            currentZoom = Math.min(currentZoom * 1.2, 5);
            mapChart.setOption({
                geo: {
                    zoom: currentZoom,
                    center: currentCenter
                }
            });
            setTimeout(() => redrawHeatmap(), 50);
        }
    });

    // 缩小
    zoomOutBtn.addEventListener('click', () => {
        if (mapChart) {
            currentZoom = Math.max(currentZoom / 1.2, 0.5);
            mapChart.setOption({
                geo: {
                    zoom: currentZoom,
                    center: currentCenter
                }
            });
            setTimeout(() => redrawHeatmap(), 50);
        }
    });

    // 重置
    resetZoomBtn.addEventListener('click', () => {
        if (mapChart) {
            currentZoom = 1.2;
            currentCenter = [104.5, 36];
            mapChart.setOption({
                geo: {
                    zoom: currentZoom,
                    center: currentCenter
                }
            });
            setTimeout(() => redrawHeatmap(), 50);
        }
    });
    
    // 监听echarts zoom/roam事件同步zoom值
    mapChart.on('geozoom', function() {
        const option = mapChart.getOption();
        if (option.geo && option.geo[0]) {
            currentZoom = option.geo[0].zoom || currentZoom;
            currentCenter = option.geo[0].center || currentCenter;
        }
    });
    
    mapChart.on('georoam', function() {
        const option = mapChart.getOption();
        if (option.geo && option.geo[0]) {
            currentZoom = option.geo[0].zoom || currentZoom;
            currentCenter = option.geo[0].center || currentCenter;
        }
    });
}

// 筛选按钮事件
function initFilterEvents() {
    // 重置按钮
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFilters);
    }

    // 省份卡片点击
    document.addEventListener('click', (e) => {
        const card = e.target.closest('.province-card');
        const moreLink = e.target.closest('.more-link');
        
        if (moreLink) {
            const province = moreLink.dataset.province;
            const cardEl = moreLink.closest('.province-card');
            
            // 展开/收起更多学生
            const isExpanded = cardEl.dataset.expanded === 'true';
            cardEl.dataset.expanded = !isExpanded;
            
            // 重新生成完整列表
            const provinceData = {};
            filteredData.students.forEach(student => {
                const p = student.province;
                if (!provinceData[p]) {
                    provinceData[p] = [];
                }
                provinceData[p].push(student);
            });
            
            const data = provinceData[province];
            if (data) {
                const students = data.students || data;
                let newHtml = '';
                
                if (!isExpanded) {
                    // 展开显示全部
                    students.forEach(student => {
                        const displayName = isUnlocked ? student.name : student.maskedName;
                        newHtml += `
                            <div class="student-item">
                                <span class="student-name">${displayName}</span>
                                <span class="student-city">· ${student.city}</span>
                            </div>
                        `;
                    });
                    moreLink.textContent = `收起 ▲`;
                } else {
                    // 收起只显示3个
                    for (let i = 0; i < Math.min(students.length, 3); i++) {
                        const student = students[i];
                        const displayName = isUnlocked ? student.name : student.maskedName;
                        newHtml += `
                            <div class="student-item">
                                <span class="student-name">${displayName}</span>
                                <span class="student-city">· ${student.city}</span>
                            </div>
                        `;
                    }
                    if (students.length > 3) {
                        moreLink.textContent = `还有${students.length - 3}人 ▼`;
                    } else {
                        moreLink.style.display = 'none';
                    }
                }
                
                const studentsContainer = cardEl.querySelector('.province-students');
                studentsContainer.innerHTML = newHtml;
            }
            return;
        }
        
        if (card && !moreLink) {
            const province = card.dataset.province;
            if (province) {
                // 高亮选中的省份卡片
                document.querySelectorAll('.province-card').forEach(c => c.classList.remove('highlight'));
                card.classList.add('highlight');
                
                // 按省份筛选
                currentProvince = province;
                applyFilters();
            }
        }
    });

    // 汉堡菜单按钮（移动端）
    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            const filterCenter = document.querySelector('.filter-center');
            if (filterCenter.style.display === 'flex') {
                filterCenter.style.display = 'none';
            } else {
                filterCenter.style.display = 'flex';
                filterCenter.style.width = '100%';
                filterCenter.style.justifyContent = 'center';
            }
        });
    }
}

// 初始化页面
async function init() {
    const skeleton = document.getElementById('skeletonLoader');
    const hideSkeleton = () => {
        skeleton.classList.add('hide');
        setTimeout(() => {
            skeleton.style.display = 'none';
        }, 500);
    };

    try {
        // 并行加载数据和地图
        const [dataLoaded, mapLoaded] = await Promise.all([
            loadData(),
            loadMapData()
        ]);

        if (dataLoaded) {
            // 初始化地图
            if (mapLoaded) {
                try { initMap(); } catch (e) { console.error('地图初始化失败:', e); }
            }

            // 生成省份列表
            try { generateProvinceList(); } catch (e) { console.error('省份列表生成失败:', e); }

            // 更新统计
            try { updateStats(); } catch (e) { console.error('统计更新失败:', e); }

            // 更新奋斗同学列表
            try { updateStrugglingList(); } catch (e) { console.error('奋斗同学列表更新失败:', e); }

            // 初始化交互
            try { initUnlockFunction(); } catch (e) { console.error('解锁功能初始化失败:', e); }
            try { initMapControls(); } catch (e) { console.error('地图控件初始化失败:', e); }
            try { initFilterEvents(); } catch (e) { console.error('筛选事件初始化失败:', e); }
            try { initTooltipInteraction(); } catch (e) { console.error('提示框交互初始化失败:', e); }
        } else {
            throw new Error('数据加载失败');
        }

        // 隐藏骨架屏（即使部分初始化失败也执行）
        setTimeout(hideSkeleton, 300);

    } catch (error) {
        console.error('初始化失败:', error);
        // 仍然隐藏骨架屏，显示错误提示
        try {
            skeleton.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100vh;">
                    <div style="text-align:center;">
                        <h2 style="color:#ff6b6b;margin-bottom:10px;">⚠️ 加载失败</h2>
                        <p style="color:#666;margin-bottom:20px;">${error.message}</p>
                        <button onclick="location.reload()" style="padding:12px 30px;background:linear-gradient(135deg,#1e6fd9,#4a9eff);color:white;border:none;border-radius:25px;cursor:pointer;font-size:14px;">重新加载</button>
                    </div>
                </div>
            `;
        } catch (e) {
            hideSkeleton();
        }
    }
}

// 初始化页脚链接事件
function initFooterEvents() {
    // 关于我们
    const aboutLink = document.getElementById('aboutLink');
    const aboutModal = document.getElementById('aboutModal');
    const aboutCloseBtn = document.getElementById('aboutCloseBtn');
    if (aboutLink) {
        aboutLink.addEventListener('click', (e) => {
            e.preventDefault();
            aboutModal.classList.add('show');
        });
    }
    if (aboutCloseBtn) {
        aboutCloseBtn.addEventListener('click', () => {
            aboutModal.classList.remove('show');
        });
    }
    if (aboutModal) {
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) aboutModal.classList.remove('show');
        });
    }
    
    // 网页简介
    const introLink = document.getElementById('introLink');
    const introModal = document.getElementById('introModal');
    const introCloseBtn = document.getElementById('introCloseBtn');
    if (introLink) {
        introLink.addEventListener('click', (e) => {
            e.preventDefault();
            introModal.classList.add('show');
        });
    }
    if (introCloseBtn) {
        introCloseBtn.addEventListener('click', () => {
            introModal.classList.remove('show');
        });
    }
    if (introModal) {
        introModal.addEventListener('click', (e) => {
            if (e.target === introModal) introModal.classList.remove('show');
        });
    }
    
    // 详情弹窗点击外部关闭
    const detailModal = document.getElementById('detailModal');
    if (detailModal) {
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) detailModal.classList.remove('show');
        });
    }
    
    // 解锁弹窗点击外部关闭
    const unlockModal = document.getElementById('unlockModal');
    if (unlockModal) {
        unlockModal.addEventListener('click', (e) => {
            if (e.target === unlockModal) unlockModal.classList.remove('show');
        });
    }
}

// 音乐播放器初始化
function initMusicPlayer() {
    const audio = document.getElementById('bgmAudio');
    const playBtn = document.getElementById('musicPlayBtn');
    const playIcon = playBtn.querySelector('.play-icon');
    const playText = playBtn.querySelector('.play-text');
    const volumeSlider = document.getElementById('musicVolume');
    
    if (!audio || !playBtn) return;
    
    // 当音频播放状态变化时更新UI
    audio.addEventListener('playing', () => {
        playBtn.classList.add('playing');
        playIcon.textContent = '⏸';
        playText.textContent = '暂停';
    });
    
    audio.addEventListener('pause', () => {
        playBtn.classList.remove('playing');
        playIcon.textContent = '▶';
        playText.textContent = '想燃一点？开播放器听歌哦';
    });
    
    audio.addEventListener('waiting', () => {
        playText.textContent = '缓冲中...';
    });
    
    audio.addEventListener('error', () => {
        console.warn('音频加载失败');
        playText.textContent = '音乐加载失败';
        setTimeout(() => {
            if (audio.paused) {
                playText.textContent = '想燃一点？开播放器听歌哦';
            }
        }, 3000);
    });
    
    audio.addEventListener('ended', () => {
        playBtn.classList.remove('playing');
        playIcon.textContent = '▶';
        playText.textContent = '想燃一点？开播放器听歌哦';
    });
    
    // 点击播放/暂停
    playBtn.addEventListener('click', () => {
        if (audio.paused) {
            const p = audio.play();
            if (p && typeof p.catch === 'function') {
                p.catch(err => {
                    console.warn('播放失败:', err);
                    playText.textContent = '播放失败，重试';
                    setTimeout(() => {
                        if (audio.paused) playText.textContent = '想燃一点？开播放器听歌哦';
                    }, 2000);
                });
            }
        } else {
            audio.pause();
        }
    });
    
    // 音量控制
    volumeSlider.addEventListener('input', (e) => {
        const vol = e.target.value / 100;
        audio.volume = vol;
    });
    
    // 初始化音量
    audio.volume = 0.7;
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 立即初始化音乐播放器（独立于地图加载）
    initMusicPlayer();
    // 初始化页脚链接事件
    initFooterEvents();
    // 安全兜底：15秒后强制隐藏骨架屏，避免一直转圈
    let safetyTimer = setTimeout(() => {
        const skeleton = document.getElementById('skeletonLoader');
        if (skeleton && skeleton.style.display !== 'none') {
            console.warn('初始化超时，强制隐藏骨架屏');
            skeleton.classList.add('hide');
            setTimeout(() => { skeleton.style.display = 'none'; }, 500);
        }
    }, 15000);
    // 加载地图和数据
    init().then(() => {
        clearTimeout(safetyTimer);
    });
});