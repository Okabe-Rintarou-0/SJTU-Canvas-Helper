import { useEffect, useState } from "react";
import { GradeStatus } from "../lib/model";
import ReactEcharts from "echarts-for-react";

// Grade Overview Component in Assignment Section
// assignment id -> grade status
export function GradeOverviewChart({ gradeMap }: { gradeMap: Map<number, GradeStatus> }) {
    const [options, setOptions] = useState<any>({});
    useEffect(() => { initOptions() }, [gradeMap]);
    const initOptions = () => {
        const actualGrades: number[] = [];
        const assignmetNames: string[] = [];
        const lossGrades: number[] = [];
        gradeMap.forEach(status => {
            actualGrades.push(status.actualGrade);
            assignmetNames.push(status.assignmetName);
            lossGrades.push(status.maxGrade - status.actualGrade);
        });
        const options = {
            xAxis: {
                data: assignmetNames,
                type: 'category',
                axisTick: {
                    alignWithLabel: true
                },
                axisLabel: {
                    with: 50,
                    interval: 0,
                    fontSize: 10,
                    formatter: function (label: string) {
                        return label.length > 4 ? label.substring(0, 4) + '...' : label;
                    }
                }
            },
            yAxis: {},
            legend: {
                data: ['得分', '扣分']
            },
            series: [
                {
                    name: '得分',
                    type: 'bar',
                    data: actualGrades,
                    stack: 'x',
                    label: {
                        show: true,
                        position: 'top'
                    },
                },
                {
                    name: '扣分',
                    type: 'bar',
                    data: lossGrades,
                    stack: 'x',
                    itemStyle: {
                        color: '#ff6666',
                    }
                }
            ],
        };
        setOptions(options);
    }


    return <>{gradeMap.size > 0 && <ReactEcharts option={options} />}</>
}